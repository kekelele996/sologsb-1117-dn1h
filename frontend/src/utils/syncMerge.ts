import type { Dataset, EntityKind } from '@/utils/syncTypes'
import { ENTITY_KINDS, entityCode } from '@/utils/syncTypes'

type Row = Record<string, unknown> & { id: string }

/** 单条记录的合并处置 */
export type MergeAction = 'takeStation' | 'takeField'

/** 合并预检里的一条记录 */
export interface MergeItem {
  kind: EntityKind
  id: string
  code: string
  /** station 相对基线的处置 */
  stationChange: 'unchanged' | 'modified' | 'deleted' | 'added'
  /** field 相对基线的处置 */
  fieldChange: 'unchanged' | 'modified' | 'deleted' | 'added'
  /** 预检结论：自动合并 / 需复核 */
  resolution: 'auto' | 'conflict'
  /** 自动合并时将采用的动作；冲突项由用户选择 */
  suggested: MergeAction
  stationRow?: Row
  fieldRow?: Row
  baseRow?: Row
  /** 冲突项的用户选择 */
  chosen?: MergeAction
}

export interface MergePreview {
  items: MergeItem[]
  autoCount: number
  conflictCount: number
}

/** 忽略合并比对中的元数据字段 */
const IGNORE_KEYS = new Set(['updatedAt'])

function shallowEqual(a: Row | undefined, b: Row | undefined): boolean {
  if (a === b) return true
  if (!a || !b) return false
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  for (const key of keys) {
    if (IGNORE_KEYS.has(key)) continue
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) return false
  }
  return true
}

function changeOf(base: Row | undefined, current: Row | undefined): MergeItem['stationChange'] {
  if (base && current) return shallowEqual(base, current) ? 'unchanged' : 'modified'
  if (base && !current) return 'deleted'
  if (!base && current) return 'added'
  return 'unchanged'
}

/**
 * 三方合并预检（驻地基线 base / 驻地现状 station / 外勤回传 field）：
 * - 只有一边改动 → 自动合并；
 * - 两边都动过（改/删/增撞车）→ 列为冲突，交人工复核。
 */
export function previewMerge(base: Dataset, station: Dataset, field: Dataset): MergePreview {
  const items: MergeItem[] = []

  ENTITY_KINDS.forEach((kind) => {
    const baseMap = new Map(base[kind].map((row) => [row.id, row as unknown as Row]))
    const stationMap = new Map(station[kind].map((row) => [row.id, row as unknown as Row]))
    const fieldMap = new Map(field[kind].map((row) => [row.id, row as unknown as Row]))
    const ids = new Set([...baseMap.keys(), ...stationMap.keys(), ...fieldMap.keys()])

    ids.forEach((id) => {
      const b = baseMap.get(id)
      const s = stationMap.get(id)
      const f = fieldMap.get(id)
      const stationChange = changeOf(b, s)
      const fieldChange = changeOf(b, f)
      const stationMoved = stationChange !== 'unchanged'
      const fieldMoved = fieldChange !== 'unchanged'

      // 两边都动过 → 复核（含同一条两边都改、一改一删、两边都删以外的组合）
      const conflict = stationMoved && fieldMoved && !(stationChange === 'deleted' && fieldChange === 'deleted')

      const display = s ?? f ?? b
      const item: MergeItem = {
        kind,
        id,
        code: display ? entityCode(kind, display) : id,
        stationChange,
        fieldChange,
        resolution: conflict ? 'conflict' : 'auto',
        suggested: suggestAction(stationChange, fieldChange),
        stationRow: s,
        fieldRow: f,
        baseRow: b
      }
      items.push(item)
    })
  })

  // 复核项排最前，其次按数据类别、编号
  items.sort((a, b) => {
    if (a.resolution !== b.resolution) return a.resolution === 'conflict' ? -1 : 1
    if (a.kind !== b.kind) return ENTITY_KINDS.indexOf(a.kind) - ENTITY_KINDS.indexOf(b.kind)
    return a.code.localeCompare(b.code, 'zh-Hans-CN')
  })

  return {
    items,
    autoCount: items.filter((item) => item.resolution === 'auto').length,
    conflictCount: items.filter((item) => item.resolution === 'conflict').length
  }
}

/** 自动合并时该取哪一边 */
function suggestAction(stationChange: MergeItem['stationChange'], fieldChange: MergeItem['fieldChange']): MergeAction {
  if (stationChange === 'unchanged' && fieldChange !== 'unchanged') return 'takeField'
  return 'takeStation'
}

/** 冲突项是否都已做出选择 */
export function allConflictsResolved(preview: MergePreview): boolean {
  return preview.items.every((item) => item.resolution === 'auto' || Boolean(item.chosen))
}

/** 按预检结论 + 冲突选择，生成最终数据集 */
export function applyMerge(station: Dataset, preview: MergePreview): Dataset {
  const result: Dataset = { orchards: [], colonies: [], dropPoints: [], routes: [] }

  ENTITY_KINDS.forEach((kind) => {
    const merged = new Map<string, Row>()
    station[kind].forEach((row) => merged.set(row.id, row as unknown as Row))

    preview.items
      .filter((item) => item.kind === kind)
      .forEach((item) => {
        const useField = item.resolution === 'conflict' ? item.chosen === 'takeField' : item.suggested === 'takeField'
        const chosenRow = useField ? item.fieldRow : item.stationRow
        if (chosenRow) {
          merged.set(item.id, chosenRow)
        } else {
          merged.delete(item.id)
        }
      })

    const out = result as unknown as Record<EntityKind, unknown>
    out[kind] = Array.from(merged.values())
  })

  return result
}

/** 字段差异（复核界面用：列出具体改了哪些字段） */
export function diffFields(a: Row | undefined, b: Row | undefined): { key: string; from: unknown; to: unknown }[] {
  if (!a || !b) return []
  const keys = new Set([...Object.keys(a), ...Object.keys(b)])
  const diffs: { key: string; from: unknown; to: unknown }[] = []
  keys.forEach((key) => {
    if (IGNORE_KEYS.has(key)) return
    if (JSON.stringify(a[key]) !== JSON.stringify(b[key])) {
      diffs.push({ key, from: a[key], to: b[key] })
    }
  })
  return diffs
}
