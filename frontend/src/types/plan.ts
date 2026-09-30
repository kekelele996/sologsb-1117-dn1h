import type { BeeColony } from './colony'
import type { DropPoint } from './droppoint'
import type { Orchard } from './orchard'
import { suggestColonyBoxes } from './orchard'

/** 排季安排方案：技术员挑好地块与蜂群后，按投放点容量自动排蜂的结果 */
export interface SeasonPlan {
  id: string
  name: string
  createdAt: string
  updatedAt: string
  /** 参与排季的地块 id */
  orchardIds: string[]
  /** 参与排季的蜂群 id */
  colonyIds: string[]
  /** 已安排：蜂群 → 投放点 */
  placements: PlanPlacement[]
  /** 排不下的蜂群排队 */
  queue: PlanQueueItem[]
  /** 投放点缺口：哪个点还差几箱 */
  dropGaps: PlanGap[]
  /** 地块授粉缺口：哪个地块还差几箱才够授粉需求 */
  orchardGaps: OrchardGap[]
  /** 方案状态：valid 有效可导出 / invalid 已失效需重算 */
  status: 'valid' | 'invalid'
  /** 引用数据指纹（地块花期 + 投放点坐标/容量），用于失效判定 */
  fingerprint: string
}

export interface PlanPlacement {
  colonyId: string
  colonyCode: string
  orchardId: string
  dropPointId: string
}

export interface PlanQueueItem {
  colonyId: string
  colonyCode: string
  reason: string
}

export interface PlanGap {
  dropPointId: string
  dropCode: string
  orchardId: string
  capacity: number
  placed: number
  /** 还差箱数（capacity - placed > 0 表示该点还可再放） */
  shortBy: number
}

export interface OrchardGap {
  orchardId: string
  orchardName: string
  /** 建议箱数（授粉需求） */
  need: number
  placed: number
  /** 还差箱数（need - placed > 0 表示该地块授粉蜂不足） */
  shortBy: number
}

export interface ArrangeResult {
  placements: PlanPlacement[]
  queue: PlanQueueItem[]
  dropGaps: PlanGap[]
  orchardGaps: OrchardGap[]
}

/** 简易字符串哈希（djb2 变体），用于指纹比对 */
export function hashString(input: string): string {
  let hash = 5381
  for (let i = 0; i < input.length; i += 1) {
    hash = ((hash << 5) + hash + input.charCodeAt(i)) | 0
  }
  return (hash >>> 0).toString(36)
}

/** 计算排季方案引用数据指纹：地块花期 + 投放点坐标/容量 */
export function planFingerprint(orchardIds: string[], orchards: Orchard[], dropPoints: DropPoint[]): string {
  const orchardPart = orchardIds
    .map((id) => {
      const orchard = orchards.find((item) => item.id === id)
      return orchard ? `${id}:${orchard.bloomStart}:${orchard.bloomEnd}` : `${id}:missing`
    })
    .sort()
    .join('|')
  const dropPart = dropPoints
    .filter((point) => orchardIds.includes(point.orchardId))
    .map((point) => `${point.id}:${point.longitude}:${point.latitude}:${point.capacityBoxes}`)
    .sort()
    .join('|')
  return hashString(`orchards:${orchardPart}#drops:${dropPart}`)
}

/** 按投放点容量排蜂群：排不下的进排队，并给出投放点/地块缺口 */
export function arrangePlan(
  orchardIds: string[],
  colonyIds: string[],
  orchards: Orchard[],
  colonies: BeeColony[],
  dropPoints: DropPoint[]
): ArrangeResult {
  const selectedOrchards = orchards.filter((item) => orchardIds.includes(item.id))
  const selectedColonies = colonies.filter((item) => colonyIds.includes(item.id))

  const dropsByOrchard = new Map<string, DropPoint[]>()
  selectedOrchards.forEach((orchard) => {
    const points = dropPoints
      .filter((point) => point.orchardId === orchard.id)
      .sort((a, b) => a.code.localeCompare(b.code, 'zh-Hans-CN'))
    dropsByOrchard.set(orchard.id, points)
  })

  const remaining = new Map<string, number>()
  dropPoints.forEach((point) => remaining.set(point.id, point.capacityBoxes))
  const placedInDrop = new Map<string, number>()
  const placedInOrchard = new Map<string, number>()

  const placements: PlanPlacement[] = []
  const queue: PlanQueueItem[] = []

  const freeCapacity = (orchard: Orchard): number => {
    const points = dropsByOrchard.get(orchard.id) ?? []
    return points.reduce((sum, point) => sum + (remaining.get(point.id) ?? 0), 0)
  }

  // 有当前所在地块的蜂群优先安排到该地块；其余按花期先后找有空位的地块
  const ordered = [...selectedColonies].sort((a, b) => {
    const aHas = a.currentOrchardId && orchardIds.includes(a.currentOrchardId) ? 0 : 1
    const bHas = b.currentOrchardId && orchardIds.includes(b.currentOrchardId) ? 0 : 1
    if (aHas !== bHas) return aHas - bHas
    return a.code.localeCompare(b.code, 'zh-Hans-CN')
  })

  const orchardPriority = [...selectedOrchards].sort((a, b) => a.bloomStart.localeCompare(b.bloomStart))

  for (const colony of ordered) {
    let target: Orchard | undefined
    if (colony.currentOrchardId && orchardIds.includes(colony.currentOrchardId)) {
      target = selectedOrchards.find((item) => item.id === colony.currentOrchardId)
    }
    if (!target || freeCapacity(target) <= 0) {
      target = orchardPriority.find((item) => freeCapacity(item) > 0)
    }

    const tryPlace = (orchard: Orchard): boolean => {
      const points = dropsByOrchard.get(orchard.id) ?? []
      for (const point of points) {
        const rem = remaining.get(point.id) ?? 0
        if (rem > 0) {
          placements.push({
            colonyId: colony.id,
            colonyCode: colony.code,
            orchardId: orchard.id,
            dropPointId: point.id
          })
          remaining.set(point.id, rem - 1)
          placedInDrop.set(point.id, (placedInDrop.get(point.id) ?? 0) + 1)
          placedInOrchard.set(orchard.id, (placedInOrchard.get(orchard.id) ?? 0) + 1)
          return true
        }
      }
      return false
    }

    let placed = false
    if (target) placed = tryPlace(target)
    if (!placed) {
      for (const orchard of orchardPriority) {
        if (tryPlace(orchard)) {
          placed = true
          break
        }
      }
    }

    if (!placed) {
      queue.push({
        colonyId: colony.id,
        colonyCode: colony.code,
        reason: target ? `${target.name} 投放点已满，其他地块也无空位` : '各地块投放点均已满，无法安排'
      })
    }
  }

  const dropGaps: PlanGap[] = dropPoints
    .filter((point) => orchardIds.includes(point.orchardId))
    .map((point) => {
      const placed = placedInDrop.get(point.id) ?? 0
      return {
        dropPointId: point.id,
        dropCode: point.code,
        orchardId: point.orchardId,
        capacity: point.capacityBoxes,
        placed,
        shortBy: point.capacityBoxes - placed
      }
    })

  const orchardGaps: OrchardGap[] = selectedOrchards.map((orchard) => {
    const need = suggestColonyBoxes(orchard)
    const placed = placedInOrchard.get(orchard.id) ?? 0
    return {
      orchardId: orchard.id,
      orchardName: orchard.name,
      need,
      placed,
      shortBy: need - placed
    }
  })

  return { placements, queue, dropGaps, orchardGaps }
}

/** 校验方案是否仍有效：指纹一致 → valid，否则 invalid */
export function revalidatePlan(plan: SeasonPlan, orchards: Orchard[], dropPoints: DropPoint[]): SeasonPlan['status'] {
  return planFingerprint(plan.orchardIds, orchards, dropPoints) === plan.fingerprint ? 'valid' : 'invalid'
}
