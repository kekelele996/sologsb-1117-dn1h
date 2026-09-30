import type { BeeColony, DropPoint, Orchard } from '@/types'

/** 排季安排有效性：有效可执行 / 依据已变需重算 */
export type PlanValidity = 'valid' | 'stale'

/** 排季方案的业务状态：草稿 / 已发布（有效性另见 PlanValidity） */
export type PlanStatus = '草稿' | '已发布'

/** 一次「按投放点容量排蜂群」的输入 */
export interface PlanInput {
  name: string
  orchardIds: string[]
  colonyIds: string[]
}

/** 单个投放点在方案中的排布结果 */
export interface PlanPointStat {
  pointId: string
  pointCode: string
  orchardId: string
  orchardName: string
  capacityBoxes: number
  colonyCodes: string[]
  /** 该点尚差几箱（容量 − 实际排入） */
  shortageBoxes: number
}

/** 单个地块在方案中的排布结果 */
export interface PlanOrchardStat {
  orchardId: string
  orchardName: string
  bloomStart: string
  bloomEnd: string
  /** 建议箱数 */
  demandBoxes: number
  /** 实际排入箱数 */
  placedBoxes: number
  /** 本地块总容量 */
  capacityBoxes: number
  /** 需求未满足的箱数（建议 − 实际排入） */
  unmetBoxes: number
  pointIds: string[]
}

/** 排队的一箱（排不下的蜂群） */
export interface PlanQueueItem {
  colonyId: string
  colonyCode: string
  intendedOrchardId: string
  intendedOrchardName: string
  /** 排队原因：投放点容量已满 / 排入会造成花期重叠冲突 */
  reason: '容量已满' | '花期冲突'
}

/** 蜂群 → 投放点的一条已排分配 */
export interface PlanAssignment {
  colonyId: string
  colonyCode: string
  orchardId: string
  pointId: string
  pointCode: string
  start: string
  end: string
}

/**
 * 方案计算时引用依据的快照。
 * 之后只要引用到的地块花期或投放点坐标等发生变化，方案即失效，需重算后才能导出。
 */
export interface PlanSnapshots {
  orchards: Pick<Orchard, 'id' | 'name' | 'bloomStart' | 'bloomEnd'>[]
  dropPoints: Pick<DropPoint, 'id' | 'code' | 'orchardId' | 'longitude' | 'latitude' | 'capacityBoxes'>[]
  colonies: Pick<BeeColony, 'id' | 'code'>[]
}

/** SeasonPlan 排季安排（一份可执行 / 待重算的排季方案） */
export interface SeasonPlan {
  id: string
  name: string
  status: PlanStatus
  createdAt: string
  calculatedAt: string
  /** 计算输入：选中的地块与蜂群 */
  input: PlanInput
  assignments: PlanAssignment[]
  queue: PlanQueueItem[]
  orchardsStat: PlanOrchardStat[]
  pointsStat: PlanPointStat[]
  /** 计算时的依据快照，用于失效判定 */
  snapshots: PlanSnapshots
}

export interface PlanBuildContext {
  orchards: Orchard[]
  colonies: BeeColony[]
  dropPoints: DropPoint[]
}
