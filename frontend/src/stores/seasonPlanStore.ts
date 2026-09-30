import { create } from 'zustand'
import type { PlanInput, SeasonPlan } from '@/types'
import { db, deleteRow, loadAll, nowStamp, putRow } from '@/hooks/usePersistentStore'
import { buildPlanResult, takeSnapshots } from '@/utils/plan'
import type { PlanBuildContext } from '@/types'

export interface SeasonPlanState {
  rows: SeasonPlan[]
  loaded: boolean
  hydrate: () => Promise<void>
  /** 依据当前台账新建并保存一份方案 */
  createPlan: (input: PlanInput, ctx: PlanBuildContext) => Promise<SeasonPlan>
  /** 依据引用数据重算（输入沿用原方案），刷新排布、排队与快照 */
  recalculate: (id: string, ctx: PlanBuildContext) => Promise<void>
  save: (row: SeasonPlan) => Promise<void>
  remove: (id: string) => Promise<void>
}

function makePlan(input: PlanInput, ctx: PlanBuildContext, existing?: SeasonPlan): SeasonPlan {
  const stamp = nowStamp()
  const result = buildPlanResult(input, ctx)
  return {
    id: existing?.id ?? `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`,
    name: input.name,
    status: existing?.status ?? '草稿',
    createdAt: existing?.createdAt ?? stamp,
    calculatedAt: stamp,
    input,
    ...result,
    snapshots: takeSnapshots(ctx, input)
  }
}

export const seasonPlanStore = create<SeasonPlanState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<SeasonPlan>(db.seasonPlans)
    rows.sort((a, b) => b.calculatedAt.localeCompare(a.calculatedAt))
    set({ rows, loaded: true })
  },
  createPlan: async (input, ctx) => {
    const plan = makePlan(input, ctx)
    await putRow<SeasonPlan>(db.seasonPlans, plan)
    await get().hydrate()
    return plan
  },
  recalculate: async (id, ctx) => {
    const existing = (await loadAll<SeasonPlan>(db.seasonPlans)).find((item) => item.id === id)
    if (!existing) return
    const plan = makePlan(existing.input, ctx, existing)
    await putRow<SeasonPlan>(db.seasonPlans, plan)
    await get().hydrate()
  },
  save: async (row) => {
    await putRow<SeasonPlan>(db.seasonPlans, row)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<SeasonPlan>(db.seasonPlans, id)
    await get().hydrate()
  }
}))
