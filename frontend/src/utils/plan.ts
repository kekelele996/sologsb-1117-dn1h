import type {
  BeeColony,
  DropPoint,
  Orchard,
  PlanAssignment,
  PlanBuildContext,
  PlanInput,
  PlanOrchardStat,
  PlanPointStat,
  PlanQueueItem,
  PlanSnapshots
} from '@/types'
import { suggestColonyBoxes } from '@/types'
import { flowerWindowOverlap } from '@/utils/geo'

/**
 * 按投放点容量把选中蜂群排进选中地块。
 *
 * 规则：
 * - 地块按盛花期起从早到晚处理；每个地块先按容量把蜂群排满；
 * - 每个投放点排入数不得超过 capacityBoxes；
 * - 同一蜂群若已排在花期重叠的另一个投放点，则该点不能再排入（避免撞期）；
 * - 排不下的蜂群进入排队，并说明意图地块与原因（该地块各点均满 / 仅因花期冲突）。
 */

interface PointBucket {
  point: DropPoint
  codes: string[]
}

interface Attempt {
  colonyId: string
  orchardId: string
  /** 遇到过「有余位但花期冲突」的点 → 排队原因为花期冲突 */
  sawConflictWithRoom: boolean
  /** 所有卡点都只是容量已满 → 排队原因为容量已满 */
  sawOnlyFull: boolean
}

/** 判定蜂群在给定投放时间窗内是否与它已有的排入重叠 */
function overlapsExisting(
  code: string,
  start: string,
  end: string,
  assignments: PlanAssignment[]
): boolean {
  return assignments.some((item) => {
    if (item.colonyCode !== code) return false
    return flowerWindowOverlap(start, end, item.start, item.end).overlap
  })
}

/** 执行一次完整排布，返回分配 / 排队 / 各点与各地块统计 */
export function buildPlanResult(
  input: PlanInput,
  ctx: PlanBuildContext
): {
  assignments: PlanAssignment[]
  queue: PlanQueueItem[]
  orchardsStat: PlanOrchardStat[]
  pointsStat: PlanPointStat[]
} {
  const orchardById = new Map(ctx.orchards.map((item) => [item.id, item]))
  const colonyById = new Map(ctx.colonies.map((item) => [item.id, item]))

  // 仅处理被选中、且在当前台账中仍存在的地块 / 蜂群
  const targets: Orchard[] = input.orchardIds
    .map((id) => orchardById.get(id))
    .filter((item): item is Orchard => Boolean(item))
    .sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))

  // 候选蜂群：群势强者优先，其次按群号
  const candidates: BeeColony[] = input.colonyIds
    .map((id) => colonyById.get(id))
    .filter((item): item is BeeColony => Boolean(item))
    .sort((a, b) => b.strengthFrames - a.strengthFrames || a.code.localeCompare(b.code, 'zh-Hans-CN'))

  const assignments: PlanAssignment[] = []
  const placedIds = new Set<string>()
  const attempts: Attempt[] = []
  const buckets = new Map<string, PointBucket>()

  targets.forEach((orchard) => {
    const points = ctx.dropPoints
      .filter((point) => point.orchardId === orchard.id)
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    points.forEach((point) => {
      buckets.set(point.id, { point, codes: [] })
    })

    const demand = suggestColonyBoxes(orchard)
    let placedHere = 0

    for (const colony of candidates) {
      // 一群蜂只能投放到一个投放点：已在更早花期地块排入的，后续地块不再占用
      if (placedIds.has(colony.id)) continue

      // 本地块建议箱数排满后不再接蜂（不能为占满容量而超需投放），
      // 但继续扫描候选，让富余蜂群尝试后续地块；缺口统计按需求口径计算
      if (placedHere >= demand) continue

      const attempt: Attempt = { colonyId: colony.id, orchardId: orchard.id, sawConflictWithRoom: false, sawOnlyFull: true }
      let placed = false

      for (const point of points) {
        const bucket = buckets.get(point.id)
        if (!bucket) continue
        if (bucket.codes.length >= point.capacityBoxes) {
          continue
        }
        if (overlapsExisting(colony.code, point.dropWindow, point.withdrawTime, assignments)) {
          attempt.sawConflictWithRoom = true
          attempt.sawOnlyFull = false
          continue
        }
        bucket.codes.push(colony.code)
        assignments.push({
          colonyId: colony.id,
          colonyCode: colony.code,
          orchardId: orchard.id,
          pointId: point.id,
          pointCode: point.code,
          start: point.dropWindow,
          end: point.withdrawTime
        })
        placedHere += 1
        placedIds.add(colony.id)
        placed = true
        break
      }

      if (!placed) attempts.push(attempt)
    }
  })

  // 统计：地块（先算，供投放点缺口分摊使用）
  const orchardsStat: PlanOrchardStat[] = targets.map((orchard) => {
    const points = ctx.dropPoints.filter((point) => point.orchardId === orchard.id)
    const placed = assignments.filter((item) => item.orchardId === orchard.id).length
    const demand = suggestColonyBoxes(orchard)
    return {
      orchardId: orchard.id,
      orchardName: orchard.name,
      bloomStart: orchard.bloomStart,
      bloomEnd: orchard.bloomEnd,
      demandBoxes: demand,
      placedBoxes: placed,
      capacityBoxes: points.reduce((sum, point) => sum + point.capacityBoxes, 0),
      unmetBoxes: Math.max(0, demand - placed),
      pointIds: points.map((point) => point.id)
    }
  })
  const orchardStatMap = new Map(orchardsStat.map((item) => [item.orchardId, item]))

  // 统计：投放点（含「还差几箱」）
  // 缺口只在地块需求未被满足时才计入：未填入且属于需求内的空位才算缺口，
  // 需求之外的富余容量保持 0，避免把「没那么多蜂可排」误报成投放点缺口。
  const pointsStat: PlanPointStat[] = []
  targets.forEach((orchard) => {
    const stat = orchardStatMap.get(orchard.id)
    let unmet = stat?.unmetBoxes ?? 0
    ctx.dropPoints
      .filter((point) => point.orchardId === orchard.id)
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
      .forEach((point) => {
        const bucket = buckets.get(point.id)
        const codes = bucket ? bucket.codes : []
        const emptySlots = Math.max(0, point.capacityBoxes - codes.length)
        // 后处理的点先承担缺口，直到本地块未满足需求被分摊完
        const shortage = Math.min(emptySlots, unmet)
        unmet -= shortage
        pointsStat.push({
          pointId: point.id,
          pointCode: point.code,
          orchardId: orchard.id,
          orchardName: orchard.name,
          capacityBoxes: point.capacityBoxes,
          colonyCodes: codes,
          shortageBoxes: shortage
        })
      })
  })

  // 排队：在所有地块都排不下的蜂群；以最后一次尝试的意图地块为准
  const queue: PlanQueueItem[] = []
  candidates.forEach((colony) => {
    if (placedIds.has(colony.id)) return
    const mine = attempts.filter((item) => item.colonyId === colony.id)
    if (mine.length === 0) return
    const last = mine[mine.length - 1]
    const reason: PlanQueueItem['reason'] = last.sawConflictWithRoom ? '花期冲突' : '容量已满'
    const orchard = orchardById.get(last.orchardId)
    queue.push({
      colonyId: colony.id,
      colonyCode: colony.code,
      intendedOrchardId: last.orchardId,
      intendedOrchardName: orchard?.name ?? '未知地块',
      reason
    })
  })

  return { assignments, queue, orchardsStat, pointsStat }
}

/** 采集计算时引用依据的快照（只保留失效判定需要的字段） */
export function takeSnapshots(ctx: PlanBuildContext, input: PlanInput): PlanSnapshots {
  const pointIds = new Set(
    ctx.dropPoints.filter((point) => input.orchardIds.includes(point.orchardId)).map((point) => point.id)
  )
  return {
    orchards: ctx.orchards
      .filter((item) => input.orchardIds.includes(item.id))
      .map((item) => ({ id: item.id, name: item.name, bloomStart: item.bloomStart, bloomEnd: item.bloomEnd })),
    dropPoints: ctx.dropPoints
      .filter((item) => pointIds.has(item.id))
      .map((item) => ({
        id: item.id,
        code: item.code,
        orchardId: item.orchardId,
        longitude: item.longitude,
        latitude: item.latitude,
        capacityBoxes: item.capacityBoxes
      })),
    colonies: ctx.colonies
      .filter((item) => input.colonyIds.includes(item.id))
      .map((item) => ({ id: item.id, code: item.code }))
  }
}
