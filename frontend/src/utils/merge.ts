import type { BeeColony, DropPoint, Orchard, SeasonPlan, TransitRoute } from '@/types'

/** 外勤离线包快照 */
export interface Snapshot {
  app: string
  exportedAt: string
  device: string
  schemaVersion: number
  data: {
    orchards: Orchard[]
    colonies: BeeColony[]
    dropPoints: DropPoint[]
    routes: TransitRoute[]
    plans?: SeasonPlan[]
  }
}

export type TableKey = 'orchards' | 'colonies' | 'dropPoints' | 'routes' | 'plans'

export type MergeStatus = 'new-field' | 'new-local' | 'identical' | 'conflict'

export interface MergeRow {
  id: string
  table: TableKey
  field: Record<string, unknown> | null
  local: Record<string, unknown> | null
  status: MergeStatus
}

export interface TableMerge {
  table: TableKey
  label: string
  rows: MergeRow[]
}

export interface MergeResult {
  tables: TableMerge[]
  /** 两边都动过的冲突行（复核时优先列出） */
  conflicts: MergeRow[]
  /** 外勤新增 */
  newFromField: MergeRow[]
  /** 本地新增 */
  newAtLocal: MergeRow[]
  /** 两边一致 */
  identical: MergeRow[]
}

export const TABLE_LABELS: Record<TableKey, string> = {
  orchards: '地块',
  colonies: '蜂群',
  dropPoints: '投放点',
  routes: '转场路线',
  plans: '排季安排'
}

export const TABLE_KEYS: TableKey[] = ['orchards', 'colonies', 'dropPoints', 'routes', 'plans']

/** 稳定序列化（按键名排序），避免对象键顺序造成的误判 */
function stableStringify(obj: unknown): string {
  return JSON.stringify(obj, (_key, value: unknown) => {
    if (value !== null && typeof value === 'object') {
      if (Array.isArray(value)) return value
      const record = value as Record<string, unknown>
      return Object.keys(record)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = record[key]
          return acc
        }, {})
    }
    return value
  })
}

/** 逐字段对比，返回两边不一致的字段名 */
export function diffFields(field: Record<string, unknown>, local: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(field), ...Object.keys(local)])
  const diff: string[] = []
  keys.forEach((key) => {
    if (stableStringify(field[key]) !== stableStringify(local[key])) diff.push(key)
  })
  return diff
}

/** 按编号合并：外勤包与本地库逐行比对，分类为 新增/一致/冲突 */
export function computeMerge(snapshot: Snapshot, localData: Record<TableKey, Record<string, unknown>[]>): MergeResult {
  const tables: TableMerge[] = []
  const conflicts: MergeRow[] = []
  const newFromField: MergeRow[] = []
  const newAtLocal: MergeRow[] = []
  const identical: MergeRow[] = []

  TABLE_KEYS.forEach((table) => {
    const fieldRows = (snapshot.data[table] ?? []) as unknown as Record<string, unknown>[]
    const localRows = localData[table] ?? []
    const localMap = new Map<string, Record<string, unknown>>()
    localRows.forEach((row) => localMap.set(String(row.id), row))

    const rows: MergeRow[] = []
    const seenIds = new Set<string>()

    fieldRows.forEach((fieldRow) => {
      const id = String(fieldRow.id)
      seenIds.add(id)
      const localRow = localMap.get(id) ?? null
      let status: MergeStatus
      if (!localRow) {
        status = 'new-field'
        newFromField.push({ id, table, field: fieldRow, local: null, status })
      } else if (stableStringify(fieldRow) === stableStringify(localRow)) {
        status = 'identical'
        identical.push({ id, table, field: fieldRow, local: localRow, status })
      } else {
        status = 'conflict'
        conflicts.push({ id, table, field: fieldRow, local: localRow, status })
      }
      rows.push({ id, table, field: fieldRow, local: localRow, status })
    })

    localRows.forEach((localRow) => {
      const id = String(localRow.id)
      if (seenIds.has(id)) return
      const status: MergeStatus = 'new-local'
      newAtLocal.push({ id, table, field: null, local: localRow, status })
      rows.push({ id, table, field: null, local: localRow, status })
    })

    tables.push({ table, label: TABLE_LABELS[table], rows })
  })

  return { tables, conflicts, newFromField, newAtLocal, identical }
}

export type Resolution = 'field' | 'local'

/** 按复核选择生成最终合并结果 */
export function buildMergedRows(
  merge: MergeResult,
  resolutions: Record<string, Resolution>
): Record<TableKey, Record<string, unknown>[]> {
  const result: Record<TableKey, Record<string, unknown>[]> = {
    orchards: [],
    colonies: [],
    dropPoints: [],
    routes: [],
    plans: []
  }
  merge.tables.forEach((tableMerge) => {
    tableMerge.rows.forEach((row) => {
      if (row.status === 'new-field') {
        result[tableMerge.table].push(row.field as Record<string, unknown>)
      } else if (row.status === 'new-local') {
        result[tableMerge.table].push(row.local as Record<string, unknown>)
      } else if (row.status === 'identical') {
        result[tableMerge.table].push(row.local as Record<string, unknown>)
      } else if (row.status === 'conflict') {
        const resolution = resolutions[`${tableMerge.table}:${row.id}`] ?? 'field'
        result[tableMerge.table].push(
          (resolution === 'field' ? row.field : row.local) as Record<string, unknown>
        )
      }
    })
  })
  return result
}
