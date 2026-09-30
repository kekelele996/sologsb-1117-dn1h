import { useStore } from 'zustand'
import type { StoreApi, UseBoundStore } from 'zustand'
import Dexie, { type Table } from 'dexie'
import type { BeeColony, DropPoint, Orchard, SeasonPlan, TransitRoute } from '@/types'
import type { Dataset, FieldPack, SyncState } from '@/utils/syncTypes'
import { buildPlanResult, takeSnapshots } from '@/utils/plan'

/** IndexedDB 数据结构版本号 */
export const SCHEMA_VERSION = 3

export interface MetaRow {
  key: string
  value: number
}

/** Dexie 封装：果园 / 蜂群 / 投放点 / 转场路线 / 排季安排 五张表 + 同步状态与元数据表 */
class BeeRouteDb extends Dexie {
  orchards!: Table<Orchard, string>
  colonies!: Table<BeeColony, string>
  dropPoints!: Table<DropPoint, string>
  routes!: Table<TransitRoute, string>
  seasonPlans!: Table<SeasonPlan, string>
  syncState!: Table<SyncState, string>
  meta!: Table<MetaRow, string>

  constructor() {
    super('gbbeeroute')
    this.version(1).stores({
      orchards: 'id, name, crop',
      colonies: 'id, code, status',
      dropPoints: 'id, orchardId, code',
      routes: 'id, fromDropId, toDropId',
      meta: 'key'
    })
    // v2：投放点新增「可容纳箱数」字段，迁移时为历史投放点补齐（按 8 箱兜底）
    this.version(2).stores({
      orchards: 'id, name, crop, bloomStart',
      colonies: 'id, code, status, currentOrchardId',
      dropPoints: 'id, orchardId, code, dropWindow',
      routes: 'id, fromDropId, toDropId, departAt',
      meta: 'key'
    })
    // v3：新增排季安排表与离线合并状态表；四类基础数据补 updatedAt（升级一条不丢）
    this.version(SCHEMA_VERSION)
      .stores({
        orchards: 'id, name, crop, bloomStart',
        colonies: 'id, code, status, currentOrchardId',
        dropPoints: 'id, orchardId, code, dropWindow',
        routes: 'id, fromDropId, toDropId, departAt',
        seasonPlans: 'id, status, calculatedAt',
        syncState: 'key',
        meta: 'key'
      })
      .upgrade(async (tx) => {
        const stamp = (row: { updatedAt?: string }): void => {
          if (!row.updatedAt) row.updatedAt = new Date(0).toISOString()
        }
        await Promise.all([
          tx
            .table<Orchard, string>('orchards')
            .toCollection()
            .modify((row) => stamp(row)),
          tx
            .table<BeeColony, string>('colonies')
            .toCollection()
            .modify((row) => stamp(row)),
          tx
            .table<DropPoint, string>('dropPoints')
            .toCollection()
            .modify((row) => {
              if (!row.capacityBoxes) row.capacityBoxes = 8
              stamp(row)
            }),
          tx
            .table<TransitRoute, string>('routes')
            .toCollection()
            .modify((row) => stamp(row))
        ])
      })
  }
}

export const db = new BeeRouteDb()

/** 写入当前数据结构版本号 */
export async function stampDbVersion(): Promise<void> {
  await db.meta.put({ key: 'schemaVersion', value: SCHEMA_VERSION })
}

/** 读取整表 */
export async function loadAll<T extends object>(table: Table<T, string>): Promise<T[]> {
  return table.toArray()
}

/** 写入一条记录 */
export async function putRow<T extends object>(table: Table<T, string>, row: T): Promise<void> {
  await table.put(row)
}

/** 删除一条记录 */
export async function deleteRow<T extends object>(table: Table<T, string>, id: string): Promise<void> {
  await table.delete(id)
}

/** Zustand store ↔ Dexie 表 的读写桥接（页面统一通过它读取 store） */
export function usePersistentStore<T extends object>(store: UseBoundStore<StoreApi<T>>): T
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector: (state: T) => S
): S
export function usePersistentStore<T extends object, S>(
  store: UseBoundStore<StoreApi<T>>,
  selector?: (state: T) => S
): T | S {
  return useStore(store, selector ?? ((state: T) => state as unknown as S))
}

/** 当前时间（ISO） */
export function nowStamp(): string {
  return new Date().toISOString()
}

/** 首次打开写入示例数据 */
export async function seedDemoData(): Promise<void> {
  const count = await db.orchards.count()
  if (count > 0) return

  const year = new Date().getFullYear()
  const stamp = nowStamp()
  const d = (monthDay: string): string => `${year}-${monthDay}`

  await db.orchards.bulkPut([
    {
      id: 'orc_ap',
      name: '北岭苹果园',
      crop: '苹果',
      areaMu: 120,
      longitude: 107.4132,
      latitude: 34.6128,
      bloomStart: d('04-08'),
      bloomEnd: d('04-18'),
      colonyIntensity: 0.1,
      ownerContact: '135****2043（周园主）',
      accessibility: '大车可达',
      historyYears: [year - 2, year - 1],
      note: '主栽富士，行距 4 m，南坡',
      updatedAt: stamp
    },
    {
      id: 'orc_cherry',
      name: '西沟樱桃坡',
      crop: '樱桃',
      areaMu: 46,
      longitude: 107.3755,
      latitude: 34.5891,
      bloomStart: d('04-12'),
      bloomEnd: d('04-21'),
      colonyIntensity: 0.2,
      ownerContact: '138****7712（李园主）',
      accessibility: '仅小车',
      historyYears: [year - 1],
      note: '坡地梯田，需小车倒运蜂箱',
      updatedAt: stamp
    },
    {
      id: 'orc_rape',
      name: '东滩油菜田',
      crop: '油菜',
      areaMu: 220,
      longitude: 107.4621,
      latitude: 34.6435,
      bloomStart: d('03-28'),
      bloomEnd: d('04-12'),
      colonyIntensity: 0.05,
      ownerContact: '137****9981（合作社）',
      accessibility: '大车可达',
      historyYears: [year - 1],
      note: '连片油菜，与苹果花期部分重叠',
      updatedAt: stamp
    }
  ])

  const species = ['意蜂', '中蜂'] as const
  const boxTypes = ['标准继箱', '平箱', '交尾箱'] as const
  const statuses = ['待投放', '在园', '转场中', '回场'] as const
  const cycleOrchard = ['', 'orc_ap', 'orc_cherry'] as const

  // 26 群蜂：保留最初三群示例，其余按群号补齐（容量合计 24，天然演示排队与地块缺口）
  const colonies: BeeColony[] = []
  for (let i = 1; i <= 26; i += 1) {
    const code = `Q-${String(i).padStart(2, '0')}`
    const preset: Partial<BeeColony> =
      i === 1
        ? { currentOrchardId: 'orc_ap', status: '在园', healthNote: '群势稳定，子脾整齐' }
        : i === 2
          ? { currentOrchardId: 'orc_rape', status: '转场中', healthNote: '轻微螨害，转场后需治螨' }
          : i === 3
            ? { currentOrchardId: '', status: '待投放', healthNote: '新分群，群势偏弱' }
            : {}
    colonies.push({
      id: `col_${String(i).padStart(3, '0')}`,
      code,
      species: i <= 3 ? (i === 3 ? '中蜂' : '意蜂') : species[i % 2],
      strengthFrames: 3 + (i % 9),
      boxType: boxTypes[i % 3],
      currentOrchardId: preset.currentOrchardId ?? cycleOrchard[i % 3],
      status: preset.status ?? statuses[i % 4],
      lastCheckDate: d(`04-${String(2 + (i % 20)).padStart(2, '0')}`),      healthNote: preset.healthNote ?? '',
      updatedAt: stamp
    })
  }
  await db.colonies.bulkPut(colonies)

  await db.dropPoints.bulkPut([
    {
      id: 'dp_a01',
      orchardId: 'orc_ap',
      longitude: 107.4108,
      latitude: 34.6142,
      code: 'A-01',
      capacityBoxes: 5,
      shade: '北侧有防风林，午后半阴',
      waterDistance: 220,
      dropWindow: d('04-07'),
      withdrawTime: d('04-19'),
      owner: '周园主',
      colonyCodes: ['Q-05', 'Q-06', 'Q-14', 'Q-15', 'Q-24'],
      updatedAt: stamp
    },
    {
      id: 'dp_a02',
      orchardId: 'orc_ap',
      longitude: 107.4161,
      latitude: 34.6109,
      code: 'A-02',
      capacityBoxes: 3,
      shade: '简易遮阴棚',
      waterDistance: 310,
      dropWindow: d('04-07'),
      withdrawTime: d('04-19'),
      owner: '周园主',
      colonyCodes: ['Q-04', 'Q-13', 'Q-23'],
      updatedAt: stamp
    },
    {
      id: 'dp_b01',
      orchardId: 'orc_rape',
      longitude: 107.4598,
      latitude: 34.6411,
      code: 'B-01',
      capacityBoxes: 8,
      shade: '无遮阴，需临时搭棚',
      waterDistance: 480,
      dropWindow: d('03-27'),
      withdrawTime: d('04-12'),
      owner: '合作社',
      colonyCodes: ['Q-07', 'Q-08', 'Q-09', 'Q-16', 'Q-17', 'Q-18', 'Q-25', 'Q-26'],
      updatedAt: stamp
    },
    {
      id: 'dp_c01',
      orchardId: 'orc_cherry',
      longitude: 107.3741,
      latitude: 34.5902,
      code: 'C-01',
      capacityBoxes: 6,
      shade: '坡顶两株核桃树遮阴',
      waterDistance: 350,
      dropWindow: d('04-11'),
      withdrawTime: d('04-22'),
      owner: '李园主',
      colonyCodes: ['Q-02', 'Q-03', 'Q-11', 'Q-12', 'Q-21', 'Q-22'],
      updatedAt: stamp
    },
    {
      id: 'dp_c02',
      orchardId: 'orc_cherry',
      longitude: 107.3729,
      latitude: 34.5886,
      code: 'C-02',
      capacityBoxes: 2,
      shade: '坡下核桃树旁，午后有阴',
      waterDistance: 410,
      dropWindow: d('04-11'),
      withdrawTime: d('04-22'),
      owner: '李园主',
      colonyCodes: ['Q-01', 'Q-20'],
      updatedAt: stamp
    }
  ])

  await db.routes.bulkPut([
    {
      id: 'rt_001',
      fromDropId: 'dp_b01',
      toDropId: 'dp_c01',
      distanceKm: 9.4,
      durationH: 0.54,
      vehicleType: '农用三轮',
      departAt: `${d('04-13')}T06:30`,
      riskNote: '西沟坡道窄，雨天泥泞，需小车倒运',
      actualNote: '待执行',
      updatedAt: stamp
    }
  ])

  // 预置一份覆盖全部地块与蜂群的排季安排，便于直接查看「容量排布 + 排队缺口」
  await seedDemoPlan(stamp)
}

/** 用示例台账生成一份初始排季安排 */
async function seedDemoPlan(stamp: string): Promise<void> {
  const [orchards, colonies, dropPoints] = await Promise.all([
    db.orchards.toArray(),
    db.colonies.toArray(),
    db.dropPoints.toArray()
  ])
  const input = { name: `${new Date().getFullYear()} 季度默认排布`, orchardIds: orchards.map((item) => item.id), colonyIds: colonies.map((item) => item.id) }
  const result = buildPlanResult(input, { orchards, colonies, dropPoints })
  const plan: SeasonPlan = {
    id: 'plan_demo',
    name: input.name,
    status: '草稿',
    createdAt: stamp,
    calculatedAt: stamp,
    input,
    ...result,
    snapshots: takeSnapshots({ orchards, colonies, dropPoints }, input)
  }
  await db.seasonPlans.put(plan)
}

/** 读取最近一次「外勤包」基线（若曾在本机导入过外勤包） */
export async function loadSyncState(): Promise<SyncState | undefined> {
  return db.syncState.get('field')
}

export async function saveSyncState(state: SyncState): Promise<void> {
  await db.syncState.put(state)
}

export async function clearSyncState(): Promise<void> {
  await db.syncState.delete('field')
}

/** 离线合并后整库替换四类基础数据（单事务，任一失败全部回滚） */
export async function replaceDataset(data: Dataset): Promise<void> {
  await db.transaction('rw', db.orchards, db.colonies, db.dropPoints, db.routes, async () => {
    await Promise.all([db.orchards.clear(), db.colonies.clear(), db.dropPoints.clear(), db.routes.clear()])
    await Promise.all([
      db.orchards.bulkPut(data.orchards),
      db.colonies.bulkPut(data.colonies),
      db.dropPoints.bulkPut(data.dropPoints),
      db.routes.bulkPut(data.routes)
    ])
  })
}

export type { FieldPack }
export type SyncStateRow = SyncState
