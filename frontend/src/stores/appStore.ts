import { create } from 'zustand'
import type { IntegrityReport } from '@/hooks/usePersistentStore'

export interface AppState {
  integrity: IntegrityReport | null
  setIntegrity: (report: IntegrityReport) => void
}

export const appStore = create<AppState>((set) => ({
  integrity: null,
  setIntegrity: (report) => set({ integrity: report })
}))
