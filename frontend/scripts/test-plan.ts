import { arrangePlan, planFingerprint, revalidatePlan } from '../src/types/plan'
import type { BeeColony, DropPoint, Orchard } from '../src/types'

// 构造测试数据
const orchards: Orchard[] = [
  {
    id: 'o1', name: '北岭苹果园', crop: '苹果', areaMu: 100, longitude: 107.4, latitude: 34.6,
    bloomStart: '2026-04-08', bloomEnd: '2026-04-18', colonyIntensity: 0.1,
    ownerContact: '', accessibility: '大车可达', historyYears: [], note: ''
  },
  {
    id: 'o2', name: '西沟樱桃坡', crop: '樱桃', areaMu: 46, longitude: 107.37, latitude: 34.58,
    bloomStart: '2026-04-12', bloomEnd: '2026-04-21', colonyIntensity: 0.2,
    ownerContact: '', accessibility: '仅小车', historyYears: [], note: ''
  }
]

const colonies: BeeColony[] = Array.from({ length: 15 }, (_, i) => ({
  id: `c${i + 1}`,
  code: `Q-${String(i + 1).padStart(2, '0')}`,
  species: '意蜂' as const,
  strengthFrames: 6,
  boxType: '标准继箱' as const,
  currentOrchardId: i < 8 ? 'o1' : '',
  status: '待投放' as const,
  lastCheckDate: '2026-04-01',
  healthNote: ''
}))

const dropPoints: DropPoint[] = [
  { id: 'd1', orchardId: 'o1', longitude: 107.41, latitude: 34.61, code: 'A-01', capacityBoxes: 8, shade: '', waterDistance: 200, dropWindow: '2026-04-07', withdrawTime: '2026-04-19', owner: '', colonyCodes: [] },
  { id: 'd2', orchardId: 'o1', longitude: 107.42, latitude: 34.62, code: 'A-02', capacityBoxes: 6, shade: '', waterDistance: 200, dropWindow: '2026-04-07', withdrawTime: '2026-04-19', owner: '', colonyCodes: [] },
  { id: 'd3', orchardId: 'o2', longitude: 107.38, latitude: 34.59, code: 'C-01', capacityBoxes: 5, shade: '', waterDistance: 300, dropWindow: '2026-04-11', withdrawTime: '2026-04-22', owner: '', colonyCodes: [] }
]

let pass = 0
let fail = 0
function assert(cond: boolean, msg: string): void {
  if (cond) { pass++; console.log(`  ✓ ${msg}`) }
  else { fail++; console.error(`  ✗ ${msg}`) }
}

console.log('=== 排季安排测试 ===')
const result = arrangePlan(['o1', 'o2'], colonies.map((c) => c.id), orchards, colonies, dropPoints)

// o1 容量 14，o2 容量 5，总容量 19 > 15 群，应全部安排
assert(result.placements.length === 15, `应安排 15 群（实际 ${result.placements.length}）`)
assert(result.queue.length === 0, `不应有排队（实际 ${result.queue.length}）`)

// 验证容量约束：每个投放点安排数不超过容量
const placedByDrop = new Map<string, number>()
result.placements.forEach((p) => placedByDrop.set(p.dropPointId, (placedByDrop.get(p.dropPointId) ?? 0) + 1))
let capacityOk = true
dropPoints.forEach((d) => {
  if ((placedByDrop.get(d.id) ?? 0) > d.capacityBoxes) capacityOk = false
})
assert(capacityOk, '各投放点安排数不超过容量')

// 验证缺口：d1 容量8 放8 → 还差0；d2 容量6 放6 → 还差0；d3 容量5 放1 → 还差4
const d1Gap = result.dropGaps.find((g) => g.dropPointId === 'd1')
const d2Gap = result.dropGaps.find((g) => g.dropPointId === 'd2')
const d3Gap = result.dropGaps.find((g) => g.dropPointId === 'd3')
assert(d1Gap?.placed === 8 && d1Gap?.shortBy === 0, `A-01 放8已满还差0（实际 放${d1Gap?.placed} 差${d1Gap?.shortBy}）`)
assert(d2Gap?.placed === 6 && d2Gap?.shortBy === 0, `A-02 放6已满还差0（实际 放${d2Gap?.placed} 差${d2Gap?.shortBy}）`)
assert(d3Gap?.placed === 1 && d3Gap?.shortBy === 4, `C-01 放1还差4（实际 放${d3Gap?.placed} 差${d3Gap?.shortBy}）`)

// 验证地块授粉缺口：o1 建议 10 箱（100亩×0.1），已放 14 → 满足（shortBy 为负表示超额）；o2 建议 10 箱（46亩×0.2=9.2→10），已放 1 → 缺 9
const o1Gap = result.orchardGaps.find((g) => g.orchardId === 'o1')
const o2Gap = result.orchardGaps.find((g) => g.orchardId === 'o2')
assert(o1Gap?.need === 10 && (o1Gap?.shortBy ?? 0) <= 0, `北岭苹果园 建议10已满足（实际 需${o1Gap?.need} 差${o1Gap?.shortBy}）`)
assert(o2Gap?.need === 10 && o2Gap?.shortBy === 9, `西沟樱桃坡 建议10缺9（实际 需${o2Gap?.need} 差${o2Gap?.shortBy}）`)

console.log('\n=== 排队测试（容量不足）===')
const smallDrops: DropPoint[] = [
  { ...dropPoints[0], capacityBoxes: 3 },
  { ...dropPoints[1], capacityBoxes: 2 },
  { ...dropPoints[2], capacityBoxes: 2 }
]
const result2 = arrangePlan(['o1', 'o2'], colonies.map((c) => c.id), orchards, colonies, smallDrops)
// 总容量 7，15 群 → 安排 7，排队 8
assert(result2.placements.length === 7, `容量7应安排7群（实际 ${result2.placements.length}）`)
assert(result2.queue.length === 8, `应有8群排队（实际 ${result2.queue.length}）`)
// 排队原因非空
assert(result2.queue.every((q) => q.reason.length > 0), '排队群都有原因说明')

console.log('\n=== 失效重算测试 ===')
const fp1 = planFingerprint(['o1', 'o2'], orchards, dropPoints)
const fp2 = planFingerprint(['o1', 'o2'], orchards, dropPoints)
assert(fp1 === fp2, '相同数据指纹一致')

// 改花期 → 指纹变化
const orchards2 = orchards.map((o) => (o.id === 'o1' ? { ...o, bloomStart: '2026-04-10' } : o))
const fp3 = planFingerprint(['o1', 'o2'], orchards2, dropPoints)
assert(fp1 !== fp3, '花期改动后指纹变化')

// 改坐标 → 指纹变化
const drops2 = dropPoints.map((d) => (d.id === 'd1' ? { ...d, longitude: 107.5 } : d))
const fp4 = planFingerprint(['o1', 'o2'], orchards, drops2)
assert(fp1 !== fp4, '投放点坐标改动后指纹变化')

// 改容量 → 指纹变化
const drops3 = dropPoints.map((d) => (d.id === 'd1' ? { ...d, capacityBoxes: 10 } : d))
const fp5 = planFingerprint(['o1', 'o2'], orchards, drops3)
assert(fp1 !== fp5, '投放点容量改动后指纹变化')

// revalidatePlan
const plan = {
  id: 'p1', name: '测试', createdAt: '', updatedAt: '',
  orchardIds: ['o1', 'o2'], colonyIds: [], placements: [], queue: [], dropGaps: [], orchardGaps: [],
  status: 'valid' as const, fingerprint: fp1
}
assert(revalidatePlan(plan, orchards, dropPoints) === 'valid', '指纹一致 → valid')
assert(revalidatePlan(plan, orchards2, dropPoints) === 'invalid', '花期变动 → invalid')
assert(revalidatePlan(plan, orchards, drops2) === 'invalid', '坐标变动 → invalid')

// 删除引用的地块 → invalid
assert(revalidatePlan(plan, [orchards[0]], dropPoints) === 'invalid', '引用地块删除 → invalid')

console.log(`\n结果：${pass} 通过，${fail} 失败`)
process.exit(fail > 0 ? 1 : 0)
