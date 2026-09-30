import { computeMerge, buildMergedRows, diffFields, type Snapshot } from '../src/utils/merge'
import type { Orchard } from '../src/types'

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string): void {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fail++; console.error(`  ✗ ${msg}`) }
}

const orchard = (id: string, name: string, bloomStart: string): Orchard => ({
  id, name, crop: '苹果', areaMu: 100, longitude: 107.4, latitude: 34.6,
  bloomStart, bloomEnd: '2026-04-18', colonyIntensity: 0.1,
  ownerContact: '', accessibility: '大车可达', historyYears: [], note: ''
})

const localOrchards: Orchard[] = [
  orchard('o1', '北岭苹果园', '2026-04-08'),
  orchard('o2', '西沟樱桃坡', '2026-04-12')
]

// 外勤离线包：o1 被外勤改了花期（冲突），o3 是外勤新增，o2 两边一致
const fieldOrchards: Orchard[] = [
  orchard('o1', '北岭苹果园', '2026-04-09'),  // 外勤改了花期
  orchard('o3', '南坡梨园', '2026-04-15')       // 外勤新增
]

const snapshot: Snapshot = {
  app: 'gbbeeroute-merge',
  exportedAt: new Date().toISOString(),
  device: '外勤手机',
  schemaVersion: 3,
  data: { orchards: fieldOrchards, colonies: [], dropPoints: [], routes: [], plans: [] }
}

const localData = {
  orchards: localOrchards as unknown as Record<string, unknown>[],
  colonies: [],
  dropPoints: [],
  routes: [],
  plans: []
}

console.log('=== 离线合并测试 ===')
const merge = computeMerge(snapshot, localData)

assert(merge.conflicts.length === 1, `应有 1 个冲突（实际 ${merge.conflicts.length}）`)
assert(merge.conflicts[0]?.id === 'o1', `冲突行是 o1（实际 ${merge.conflicts[0]?.id}）`)
assert(merge.newFromField.length === 1, `外勤新增 1 条（实际 ${merge.newFromField.length}）`)
assert(merge.newFromField[0]?.id === 'o3', `外勤新增是 o3（实际 ${merge.newFromField[0]?.id}）`)
assert(merge.newAtLocal.length === 1, `本地新增 1 条 o2（实际 ${merge.newAtLocal.length}）`)
assert(merge.newAtLocal[0]?.id === 'o2', `本地新增是 o2（实际 ${merge.newAtLocal[0]?.id}）`)
assert(merge.identical.length === 0, `无一致行（实际 ${merge.identical.length}）`)

// diffFields 应识别出 bloomStart 差异
const diff = diffFields(fieldOrchards[0] as unknown as Record<string, unknown>, localOrchards[0] as unknown as Record<string, unknown>)
assert(diff.includes('bloomStart'), `diffFields 识别出 bloomStart 差异（实际 ${diff.join(',')}）`)

// 采用外勤版合并
const mergedField = buildMergedRows(merge, { 'orchards:o1': 'field' })
const o1Field = mergedField.orchards.find((r) => r.id === 'o1') as unknown as Orchard
assert(o1Field.bloomStart === '2026-04-09', `采用外勤版 o1 花期为 04-09（实际 ${o1Field.bloomStart}）`)
assert(mergedField.orchards.length === 3, `合并后 3 条（实际 ${mergedField.orchards.length}）`)

// 保留本地版合并
const mergedLocal = buildMergedRows(merge, { 'orchards:o1': 'local' })
const o1Local = mergedLocal.orchards.find((r) => r.id === 'o1') as unknown as Orchard
assert(o1Local.bloomStart === '2026-04-08', `保留本地版 o1 花期为 04-08（实际 ${o1Local.bloomStart}）`)

// 无冲突时默认合并：new-field 写入、new-local 保留、identical 保留
const snapshot2: Snapshot = {
  app: 'gbbeeroute-merge',
  exportedAt: new Date().toISOString(),
  device: '外勤手机',
  schemaVersion: 3,
  data: { orchards: [orchard('o1', '北岭苹果园', '2026-04-08')], colonies: [], dropPoints: [], routes: [], plans: [] }
}
const merge2 = computeMerge(snapshot2, localData)
assert(merge2.identical.length === 1, `o1 两边一致（实际 ${merge2.identical.length}）`)
assert(merge2.conflicts.length === 0, `无冲突（实际 ${merge2.conflicts.length}）`)

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
