import type { BeeColony, DropPoint, Orchard, PlanValidity, SeasonPlan } from '@/types'

export interface StaleReason {
  level: 'orchard' | 'dropPoint' | 'colony'
  id: string
  label: string
  detail: string
}

const COORD_EPSILON = 1e-6

function coordChanged(a: number, b: number): boolean {
  return Math.abs(a - b) > COORD_EPSILON
}

/**
 * 依据当前地块 / 投放点 / 蜂群台账，检查排季方案是否仍有效。
 *
 * 失效条件（引用过的依据被改动）：
 * - 引用的地块被删除，或盛花期起止发生变化；
 * - 引用的投放点被删除，或坐标发生变化（容量变化也要求重算，保证容量口径最新）；
 * - 方案中已排入或选中的蜂群被删除。
 */
export function checkPlanStale(
  plan: SeasonPlan,
  data: { orchards: Orchard[]; dropPoints: DropPoint[]; colonies: BeeColony[] }
): { validity: PlanValidity; reasons: StaleReason[] } {
  const reasons: StaleReason[] = []

  plan.snapshots.orchards.forEach((snap) => {
    const current = data.orchards.find((item) => item.id === snap.id)
    if (!current) {
      reasons.push({ level: 'orchard', id: snap.id, label: snap.name, detail: '地块已被删除' })
      return
    }
    if (current.bloomStart !== snap.bloomStart || current.bloomEnd !== snap.bloomEnd) {
      reasons.push({
        level: 'orchard',
        id: snap.id,
        label: current.name,
        detail: `盛花期由 ${snap.bloomStart} ~ ${snap.bloomEnd} 改为 ${current.bloomStart} ~ ${current.bloomEnd}`
      })
    }
  })

  plan.snapshots.dropPoints.forEach((snap) => {
    const current = data.dropPoints.find((item) => item.id === snap.id)
    if (!current) {
      reasons.push({ level: 'dropPoint', id: snap.id, label: snap.code, detail: '投放点已被删除' })
      return
    }
    if (coordChanged(current.longitude, snap.longitude) || coordChanged(current.latitude, snap.latitude)) {
      reasons.push({
        level: 'dropPoint',
        id: snap.id,
        label: `${snap.code}`,
        detail: `坐标由 (${snap.longitude}, ${snap.latitude}) 改为 (${current.longitude}, ${current.latitude})`
      })
    }
    if (current.capacityBoxes !== snap.capacityBoxes) {
      reasons.push({
        level: 'dropPoint',
        id: snap.id,
        label: `${snap.code}`,
        detail: `可容纳箱数由 ${snap.capacityBoxes} 改为 ${current.capacityBoxes}`
      })
    }
  })

  plan.snapshots.colonies.forEach((snap) => {
    if (!data.colonies.some((item) => item.id === snap.id)) {
      reasons.push({ level: 'colony', id: snap.id, label: snap.code, detail: '蜂群已被删除' })
    }
  })

  return { validity: reasons.length > 0 ? 'stale' : 'valid', reasons }
}
