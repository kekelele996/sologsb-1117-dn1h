# 蜜蜂授粉路线规划器（gbbeeroute）

面向果园托管服务队与蜂场技术员，把「果园地块 → 花期 → 蜂群投放点 → 转场路线」排成季内可执行的授粉安排，解决花期重叠时蜂群撞车、转场距离过远、投放点与地块不匹配的问题。**纯前端单页应用**，全部数据保存在浏览器 IndexedDB，不依赖任何后端服务或外部接口。

本季执行能力：

- **按投放点容量排蜂群**：技术员挑好地块与蜂群后，系统按盛花期先后与各点容量排布；排不下的蜂群进入**排队队列**，并在方案中**说清是哪个投放点（地块）还差几箱**；
- **依据变动即失效**：地块盛花期、投放点坐标 / 容量或引用的蜂群一旦改动，引用过它的排季安排立即标记为「失效待重算」，**重算前不能作为可执行方案导出**；
- **外勤离线作业与回传合并**：驻地导出外勤数据包（自动留基线），外勤导入后离线修改，回驻地**按编号三方合并**；只有一边改动的自动合并，**两边都动过的记录置顶列出、逐条复核**；
- **升级不丢数据**：IndexedDB 带版本迁移（当前 v3），老浏览器里的地块、蜂群、投放点、路线升级后一条不丢，并自动补齐新字段。

## 一、Docker 一键启动（推荐）

```bash
cp .env.example .env      # 首次启动先复制环境变量文件
docker compose up -d --build
```

启动后访问：<http://localhost:21817>

```bash
docker compose ps        # 查看容器状态
docker compose logs -f   # 查看日志
docker compose down      # 停止并移除容器（数据在浏览器本地）
```

`.env` 可调：

```
COMPOSE_PROJECT_NAME=gbbeeroute
FRONTEND_PORT=21817
VITE_AMAP_KEY=            # 可选，留空即自动降级为本地 SVG 网格视图
```

## 二、技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 |
| 语言 | TypeScript（`tsc --noEmit` 类型检查零错误） |
| UI 组件库 | Ant Design 5 |
| 地图 | 高德地图 JS API 2.0（可选，key 走 `VITE_AMAP_KEY`） |
| 状态管理 | Zustand |
| 路由 | React Router 6（nginx `try_files` 回落） |
| 构建 | Vite 5 |
| 本地存储 | IndexedDB（Dexie 封装，含 `schemaVersion` 与升级迁移，当前 v3） |
| 部署 | 多阶段 Dockerfile：`node:20-alpine` 构建 → `nginx:alpine` 托管 |

## 三、高德地图 Key 与降级策略

- 在 `.env` 里填写 `VITE_AMAP_KEY=<你的 key>` 后**重新构建**（`docker compose up -d --build`），地图将使用高德 JS API 渲染地块、投放点与转场折线；
- **未配置 key 或脚本加载失败时，`RouteMap` 自动降级为本地 SVG 网格视图**：按经纬度线性映射渲染地块、投放点与转场折线，支持点选拾取坐标；
- **构建与运行都不依赖该 key**：未配置 key 时不会注入任何外部脚本（避免无谓请求与报错），Docker 构建零网络依赖即可通过；
- 页面右上角始终显示当前数据源（高德地图 JS API / 本地 SVG 网格视图）。

## 四、本地开发

```bash
cd frontend
npm install
npm run dev        # http://localhost:21817
npm run build      # 类型检查 + 生产构建
```

## 五、目录结构

```
sologsb-1117/
├── docker-compose.yml          # 顶层 name: gbbeeroute，无 version 字段
├── .env.example                # COMPOSE_PROJECT_NAME / FRONTEND_PORT / VITE_AMAP_KEY
├── frontend/
│   ├── Dockerfile              # 多阶段构建，nginx 阶段 chmod -R a+rX 静态资源
│   ├── nginx.conf              # try_files 前端路由回落 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/              # orchard / colony / droppoint / route / seasonPlan / index
│       ├── stores/             # orchardStore / colonyStore / droppointStore / routeStore / seasonPlanStore（Zustand）
│       ├── components/common/  # RouteMap / FlowerWindowBar / StatusTag / CoordPicker
│       ├── hooks/              # useAmap / usePersistentStore
│       ├── pages/              # Schedule / SeasonPlans / Orchards / Colonies / Routes / Sync / Export
│       ├── router/index.tsx
│       └── utils/              # geo / plan / planValidity / syncTypes / syncMerge / syncPack / export / id
```

## 六、数据模型与存储

| 模型 | 说明 | Dexie 表 |
| --- | --- | --- |
| Orchard 果园地块 | 地块名、作物、面积、经纬度、盛花期起止、需蜂强度（箱/亩）、园主联系方式、可达性、历史授粉年份 | `orchards` |
| BeeColony 蜂群 | 群号、蜂种、群势（足框）、箱型、当前所在地块、状态（待投放/在园/转场中/回场）、最近检查日期、健康备注 | `colonies` |
| DropPoint 投放点 | 所属地块、坐标、编号、可容纳箱数、遮阴条件、水源距离、投放时间窗、撤场时间、责任人、安排群号 | `dropPoints` |
| TransitRoute 转场路线 | 出发/到达投放点、预计里程与耗时、车辆类型、出发时刻、风险备注、实际记录 | `routes` |
| SeasonPlan 排季安排 | 方案名、状态、选中地块/蜂群、蜂群→投放点分配、排队队列、各点与各地块缺口、计算时依据快照 | `seasonPlans` |

- 四类基础数据均带 `updatedAt`，供离线三方合并识别变更；
- 数据库名 `gbbeeroute`，`meta` 表保存 `schemaVersion`，`syncState` 表保存外勤包基线；
- `version(2)` 升级迁移会为历史投放点补齐「可容纳箱数」（默认 8 箱）；
- `version(3)` 新增排季安排表与同步状态表，并为四类历史数据补齐 `updatedAt`（**只增不删，老数据一条不丢**）；
- 数据仅存于浏览器本地，容器无状态、不挂载命名卷。

### 排季与失效规则

- **排布**：地块按盛花期起从早到晚处理；候选蜂群按群势（足框）从强到弱、群号次序排入；每个投放点不超过 `capacityBoxes`；同一蜂群只占一个投放点，且不与已有投放的时间窗重叠。
- **排队与缺口**：排不下的蜂群进入队列并给出原因（「容量已满」/「花期冲突」）与意图地块；方案同时列出每个投放点的「容量 / 已排 / 还差几箱」和每个地块的建议箱数与缺口。
- **失效判定**（`utils/planValidity.ts`）：方案保存时记录引用依据快照；之后引用的地块被删除或盛花期变化、投放点被删除或坐标 / 容量变化、引用的蜂群被删除，方案即变为「失效待重算」。失效方案在「排季安排」与「导出与打印」页均被禁止导出，重算后恢复「可执行」。

### 外勤离线合并

- **驻地导出外勤包**：打包四类基础数据（`gbbeeroute-field-pack`），并在本机 `syncState` 存一份基线；
- **外勤离线作业**：外勤设备导入外勤包（整体替换本机四类数据）后可断网修改，改完导出回传包；
- **回驻地三方合并**：以「基线 / 驻地现状 / 外勤回传」三方比对——仅一边改动自动合并；**两边都动过（同条同改、一改一删、双方都新增同 id）一律列为冲突置顶**，逐条选择「保留驻地 / 采用外勤」，也可一键全选，确认后单事务整库替换。合并按记录 `id` 对应，界面以地块名 / 群号 / 投放点编号等「编号」展示。

## 七、主要页面

| 路由 | 功能 |
| --- | --- |
| `/` | 季内授粉安排总表：花期条带 + 已投放群体，冲突（同一蜂群被排入花期重叠的不同地块）标红并汇总；顶部提示失效待重算的排季方案 |
| `/plans` | **排季安排**：选地块与蜂群 → 按投放点容量排布；查看排队队列与「哪个点还差几箱」；依据变动的方案标红失效并可一键重算 |
| `/orchards` | 果园地块管理：面积与需蜂强度自动算建议箱数、可达性标记、花期重叠提示、投放点维护（含坐标拾取） |
| `/colonies` | 蜂群台账：按群势与状态筛选，批量改状态、批量记录检查备注 |
| `/routes` | 转场路线规划：地图依次选点生成顺序与里程，拖动或上下移动调整顺序并实时重算，写回路线表 |
| `/sync` | **外勤离线合并**：驻地导出外勤包 / 外勤导入离线作业并导出回传包 / 驻地按编号三方合并，两边都动过的记录置顶复核 |
| `/export` | 导出**可执行授粉安排** / **排队与缺口清单** / 转场路线表（CSV）、全量 JSON 备份；失效方案禁止导出执行清单 |

## 八、计算约定

- 建议箱数 = ⌈面积(亩) × 需蜂强度(箱/亩)⌉，最少 1 箱；
- 转场里程按 Haversine 球面距离累计，耗时按平均 32 km/h + 0.25 h 装卸估算；
- 花期重叠：两地块盛花期区间交集天数 ≥ 1 即视为重叠；同一群号在重叠期内被排入两个地块 → 冲突。
