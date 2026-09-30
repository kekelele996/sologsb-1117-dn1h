import { create } from 'zustand'
import type { BeeColony, DropPoint, Orchard, SeasonPlan } from '@/types'
import { arrangePlan, planFingerprint, revalidatePlan } from '@/types'
import { db, deleteRow, loadAll, putRow } from '@/hooks/usePersistentStore'

export interface PlanState {
  rows: SeasonPlan[]
  loaded: boolean
  hydrate: () => Promise<void>
  save: (plan: SeasonPlan) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 按当前数据重算方案，刷新快照与指纹，状态置为 valid */
  recalculate: (id: string) => Promise<void>
  /** 校验全部方案：指纹变化的置为 invalid */
  revalidateAll: () => Promise<void>
}

export const planStore = create<PlanState>((set, get) => ({
  rows: [],
  loaded: false,
  hydrate: async () => {
    const rows = await loadAll<SeasonPlan>(db.plans)
    rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    set({ rows, loaded: true })
    await get().revalidateAll()
  },
  save: async (plan) => {
    await putRow<SeasonPlan>(db.plans, plan)
    await get().hydrate()
  },
  remove: async (id) => {
    await deleteRow<SeasonPlan>(db.plans, id)
    await get().hydrate()
  },
  recalculate: async (id) => {
    const plan = get().rows.find((item) => item.id === id)
    if (!plan) return
    const [orchards, colonies, dropPoints] = await Promise.all([
      loadAll<Orchard>(db.orchards),
      loadAll<BeeColony>(db.colonies),
      loadAll<DropPoint>(db.dropPoints)
    ])
    const result = arrangePlan(plan.orchardIds, plan.colonyIds, orchards, colonies, dropPoints)
    const next: SeasonPlan = {
      ...plan,
      placements: result.placements,
      queue: result.queue,
      dropGaps: result.dropGaps,
      orchardGaps: result.orchardGaps,
      fingerprint: planFingerprint(plan.orchardIds, orchards, dropPoints),
      status: 'valid',
      updatedAt: new Date().toISOString()
    }
    await putRow<SeasonPlan>(db.plans, next)
    await get().hydrate()
  },
  revalidateAll: async () => {
    const [orchards, dropPoints] = await Promise.all([
      loadAll<Orchard>(db.orchards),
      loadAll<DropPoint>(db.dropPoints)
    ])
    const rows = await loadAll<SeasonPlan>(db.plans)
    let changed = false
    await Promise.all(
      rows.map(async (plan) => {
        const status = revalidatePlan(plan, orchards, dropPoints)
        if (status !== plan.status) {
          await putRow<SeasonPlan>(db.plans, { ...plan, status })
          changed = true
        }
      })
    )
    if (changed) {
      const fresh = await loadAll<SeasonPlan>(db.plans)
      fresh.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
      set({ rows: fresh })
    }
  }
}))
