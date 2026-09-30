import type { BeeColony, DropPoint, Orchard, TransitRoute } from '@/types'

/** 参与离线合并的四类基础数据 */
export interface Dataset {
  orchards: Orchard[]
  colonies: BeeColony[]
  dropPoints: DropPoint[]
  routes: TransitRoute[]
}

export type EntityKind = keyof Dataset

/** 外勤数据包：base 为导出外勤包时的驻地基线，field 为外勤离线修改后的现状 */
export interface FieldPack extends Dataset {
  /** 固定标识，导入时校验 */
  kind: 'gbbeeroute-field-pack'
  exportedAt: string
  exportedBy: string
}

/** 驻地保存的同步状态（记录外勤包基线，回传时做三方合并） */
export interface SyncState {
  key: 'field'
  exportedAt: string
  exportedBy: string
  importedAt: string
  base: Dataset
}

export const ENTITY_KINDS: EntityKind[] = ['orchards', 'colonies', 'dropPoints', 'routes']

export const ENTITY_LABELS: Record<EntityKind, string> = {
  orchards: '果园地块',
  colonies: '蜂群',
  dropPoints: '投放点',
  routes: '转场路线'
}

/** 各类数据在界面上展示的「编号」字段（按编号合并 / 列出复核） */
export const CODE_FIELDS: Record<EntityKind, string> = {
  orchards: 'name',
  colonies: 'code',
  dropPoints: 'code',
  routes: 'id'
}

export function entityCode(kind: EntityKind, row: Record<string, unknown>): string {
  const field = CODE_FIELDS[kind]
  const value = row[field]
  return typeof value === 'string' && value ? value : String(row.id ?? '')
}

export function emptyDataset(): Dataset {
  return { orchards: [], colonies: [], dropPoints: [], routes: [] }
}

export function isFieldPack(value: unknown): value is FieldPack {
  if (typeof value !== 'object' || value === null) return false
  const pack = value as Partial<FieldPack>
  return (
    pack.kind === 'gbbeeroute-field-pack' &&
    Array.isArray(pack.orchards) &&
    Array.isArray(pack.colonies) &&
    Array.isArray(pack.dropPoints) &&
    Array.isArray(pack.routes)
  )
}
