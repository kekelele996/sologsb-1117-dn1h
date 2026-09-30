import { useEffect, useMemo, useRef, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Input, Row, Space, Table, Tag, Typography, message } from 'antd'
import type { Dataset } from '@/utils/syncTypes'
import { ENTITY_KINDS, ENTITY_LABELS } from '@/utils/syncTypes'
import { exportFieldPack, readPackFile } from '@/utils/syncPack'
import { allConflictsResolved, applyMerge, diffFields, previewMerge } from '@/utils/syncMerge'
import type { MergeAction, MergeItem, MergePreview } from '@/utils/syncMerge'
import {
  clearSyncState,
  loadSyncState,
  nowStamp,
  replaceDataset,
  saveSyncState,
  usePersistentStore,
  type SyncStateRow
} from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'

type SyncMode = 'station' | 'field'

/** 外勤离线作业与回传合并：按编号并入，两边都动过的先列出来复核 */
export default function SyncPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)

  const [mode, setMode] = useState<SyncMode>('station')
  const [operator, setOperator] = useState('')
  const [syncState, setSyncState] = useState<SyncStateRow | undefined>(undefined)
  const [preview, setPreview] = useState<MergePreview | null>(null)

  const fieldImportRef = useRef<HTMLInputElement>(null)
  const returnImportRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void loadSyncState().then(setSyncState)
  }, [])

  const stationData = useMemo<Dataset>(() => ({ orchards, colonies, dropPoints, routes }), [orchards, colonies, dropPoints, routes])

  async function hydrateAll(): Promise<void> {
    await Promise.all([
      orchardStore.getState().hydrate(),
      colonyStore.getState().hydrate(),
      droppointStore.getState().hydrate(),
      routeStore.getState().hydrate()
    ])
  }

  /** 驻地：导出外勤数据包，并把基线存起来供回传时三方比对 */
  function handleExportFieldPack(): void {
    exportFieldPack(stationData, operator)
    const state: SyncStateRow = {
      key: 'field',
      exportedAt: nowStamp(),
      exportedBy: operator.trim() || '驻地',
      importedAt: '',
      base: stationData
    }
    void saveSyncState(state).then(() => setSyncState(state))
    message.success('外勤数据包已导出，基线已记录；外勤可离线修改后回传')
  }

  /** 外勤：导入数据包到本机，开始离线作业 */
  async function handleFieldImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = await readPackFile(file)
    if (!result.ok || !result.pack) {
      message.error(result.message)
      return
    }
    await replaceDataset(result.pack)
    await hydrateAll()
    message.success(`外勤数据包已载入本机（${result.pack.exportedBy} 于 ${result.pack.exportedAt.slice(0, 10)} 导出），可离线修改`)
  }

  /** 外勤：改完后回驻地导出回传包 */
  function handleFieldExport(): void {
    exportFieldPack(stationData, operator || '外勤')
    message.success('回传包已导出，带回驻地在「驻地合并」中导入')
  }

  /** 驻地：读取回传包，生成三方合并预检 */
  async function handleReturnImport(event: React.ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return
    const result = await readPackFile(file)
    if (!result.ok || !result.pack) {
      message.error(result.message)
      return
    }
    if (!syncState) {
      message.error('本机没有对应的外勤基线，请先在本机导出外勤数据包后再合并')
      return
    }
    const next = previewMerge(syncState.base, stationData, result.pack)
    setPreview(next)
    message.success(`预检完成：自动合并 ${next.autoCount} 条，需复核 ${next.conflictCount} 条`)
  }

  function chooseConflict(id: string, action: MergeAction): void {
    setPreview((prev) => (prev ? { ...prev, items: prev.items.map((item) => (item.id === id ? { ...item, chosen: action } : item)) } : prev))
  }

  function resolveAll(action: MergeAction): void {
    setPreview((prev) =>
      prev ? { ...prev, items: prev.items.map((item) => (item.resolution === 'conflict' ? { ...item, chosen: action } : item)) } : prev
    )
  }

  async function applyMerged(): Promise<void> {
    if (!preview) return
    if (!allConflictsResolved(preview)) {
      message.warning('仍有两边都动过的记录未复核，请逐条选择保留版本')
      return
    }
    const merged = applyMerge(stationData, preview)
    const stamp = nowStamp()
    const stamped: Dataset = {
      orchards: merged.orchards.map((row) => ({ ...row, updatedAt: stamp })),
      colonies: merged.colonies.map((row) => ({ ...row, updatedAt: stamp })),
      dropPoints: merged.dropPoints.map((row) => ({ ...row, updatedAt: stamp })),
      routes: merged.routes.map((row) => ({ ...row, updatedAt: stamp }))
    }
    await replaceDataset(stamped)
    await clearSyncState()
    setSyncState(undefined)
    setPreview(null)
    await hydrateAll()
    message.success('回传数据已按编号合并，冲突项按复核选择处理')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">外勤离线与回传合并</h2>
          <p className="page-sub">
            驻地导出外勤数据包（自动记录基线）→ 外勤在自己设备上导入并离线修改 → 改完导出回传包 → 回驻地按编号三方合并；两边都动过的记录排在最前，逐条复核后再入库。
          </p>
        </div>
      </div>

      <input ref={fieldImportRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleFieldImport(event)} />
      <input ref={returnImportRef} type="file" accept="application/json,.json" hidden onChange={(event) => void handleReturnImport(event)} />

      <Card size="small">
        <Space wrap>
          <Button type={mode === 'station' ? 'primary' : 'default'} onClick={() => setMode('station')}>
            驻地（导出外勤包 / 合并回传包）
          </Button>
          <Button type={mode === 'field' ? 'primary' : 'default'} onClick={() => setMode('field')}>
            外勤（导入离线作业 / 导出回传包）
          </Button>
          <Input style={{ width: 180 }} placeholder="操作人，如 王外勤" value={operator} onChange={(event) => setOperator(event.target.value)} />
        </Space>
      </Card>

      {mode === 'station' ? (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={9}>
            <Card size="small" title="① 导出外勤数据包">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
                  把当前地块、蜂群、投放点、路线四类数据整体打包；导出时同步在本机记录一份基线，回传时据此识别「两边都动过」的记录。
                </Typography.Paragraph>
                <Button type="primary" onClick={handleExportFieldPack}>
                  导出外勤数据包（JSON）
                </Button>
                {syncState ? (
                  <Tag color="blue">
                    已记录基线：{syncState.exportedBy} · {syncState.exportedAt.slice(0, 10)}
                  </Tag>
                ) : (
                  <Tag>本机尚无外勤基线</Tag>
                )}
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={15}>
            <Card
              size="small"
              title="② 合并外勤回传包"
              extra={
                <Button size="small" onClick={() => returnImportRef.current?.click()}>
                  选择回传包
                </Button>
              }
            >
              {!preview ? (
                <Empty description="尚未选择回传包" />
              ) : (
                <MergeReview preview={preview} onChoose={chooseConflict} onResolveAll={resolveAll} onApply={() => void applyMerged()} />
              )}
            </Card>
          </Col>
        </Row>
      ) : (
        <Row gutter={[16, 16]}>
          <Col xs={24} lg={12}>
            <Card size="small" title="① 导入驻地外勤数据包">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
                  导入后本机会以包内数据为准（四类基础数据整体替换），随后即可在无网络环境下通过各管理页修改。
                </Typography.Paragraph>
                <Button onClick={() => fieldImportRef.current?.click()}>选择外勤数据包</Button>
              </Space>
            </Card>
          </Col>
          <Col xs={24} lg={12}>
            <Card size="small" title="② 改完回驻地：导出回传包">
              <Space direction="vertical" style={{ width: '100%' }}>
                <Typography.Paragraph type="secondary" style={{ fontSize: 13, marginBottom: 4 }}>
                  离线修改完成后，把当前四类数据导出为回传包，带回驻地在「驻地 → 合并外勤回传包」中导入。
                </Typography.Paragraph>
                <Button type="primary" onClick={handleFieldExport}>
                  导出回传包（JSON）
                </Button>
                <Space wrap>
                  {ENTITY_KINDS.map((kind) => (
                    <Tag key={kind}>
                      {ENTITY_LABELS[kind]} {stationData[kind].length}
                    </Tag>
                  ))}
                </Space>
              </Space>
            </Card>
          </Col>
        </Row>
      )}
    </div>
  )
}

const CHANGE_LABEL: Record<MergeItem['stationChange'], string> = {
  unchanged: '未改',
  modified: '已改',
  deleted: '已删',
  added: '新增'
}

/** 合并复核：冲突项置顶，逐条选择采用驻地还是外勤版本 */
function MergeReview({
  preview,
  onChoose,
  onResolveAll,
  onApply
}: {
  preview: MergePreview
  onChoose: (id: string, action: MergeAction) => void
  onResolveAll: (action: MergeAction) => void
  onApply: () => void
}): JSX.Element {
  const unresolved = preview.items.filter((item) => item.resolution === 'conflict' && !item.chosen).length

  return (
    <Space direction="vertical" size={10} style={{ width: '100%' }}>
      <Alert
        type={preview.conflictCount > 0 ? 'warning' : 'success'}
        showIcon
        message={
          preview.conflictCount > 0
            ? `${preview.conflictCount} 条两边都动过，已置顶待复核；其余 ${preview.autoCount} 条将自动合并`
            : `没有两边都动过的记录，${preview.autoCount} 条变更将自动合并`
        }
      />
      {preview.conflictCount > 0 ? (
        <Space wrap>
          <Button size="small" onClick={() => onResolveAll('takeStation')}>
            冲突全部保留驻地版
          </Button>
          <Button size="small" onClick={() => onResolveAll('takeField')}>
            冲突全部采用外勤版
          </Button>
          <Button size="small" type="primary" disabled={unresolved > 0} onClick={onApply}>
            {unresolved > 0 ? `还有 ${unresolved} 条待复核` : '确认合并入库'}
          </Button>
        </Space>
      ) : (
        <Button type="primary" onClick={onApply}>
          确认合并入库
        </Button>
      )}
      <Table<MergeItem>
        size="small"
        pagination={false}
        rowKey={(record) => `${record.kind}-${record.id}`}
        dataSource={preview.items}
        rowClassName={(record) => (record.resolution === 'conflict' ? 'conflict-row' : '')}
        columns={[
          {
            title: '类别',
            dataIndex: 'kind',
            key: 'kind',
            width: 90,
            render: (value: MergeItem['kind']) => ENTITY_LABELS[value]
          },
          { title: '编号', dataIndex: 'code', key: 'code', width: 120 },
          {
            title: '驻地',
            dataIndex: 'stationChange',
            key: 'station',
            width: 70,
            render: (value: MergeItem['stationChange']) => <Tag>{CHANGE_LABEL[value]}</Tag>
          },
          {
            title: '外勤',
            dataIndex: 'fieldChange',
            key: 'field',
            width: 70,
            render: (value: MergeItem['fieldChange']) => <Tag color="blue">{CHANGE_LABEL[value]}</Tag>
          },
          {
            title: '处置',
            key: 'resolution',
            width: 180,
            render: (_, record) =>
              record.resolution === 'auto' ? (
                <Tag color="green">自动{record.suggested === 'takeField' ? '取外勤' : '取驻地'}</Tag>
              ) : (
                <Space size={4}>
                  <Button size="small" type={record.chosen === 'takeStation' ? 'primary' : 'default'} onClick={() => onChoose(record.id, 'takeStation')}>
                    保留驻地
                  </Button>
                  <Button size="small" type={record.chosen === 'takeField' ? 'primary' : 'default'} onClick={() => onChoose(record.id, 'takeField')}>
                    采用外勤
                  </Button>
                </Space>
              )
          },
          {
            title: '差异字段',
            key: 'diff',
            render: (_, record) => <DiffText item={record} />
          }
        ]}
      />
    </Space>
  )
}

type DiffRow = (Record<string, unknown> & { id: string }) | undefined

/** 复核行的字段差异简述 */
function DiffText({ item }: { item: MergeItem }): JSX.Element {
  const diffs = diffFields(item.stationRow as DiffRow, item.fieldRow as DiffRow)
  if (diffs.length === 0) {
    return <Typography.Text type="secondary" style={{ fontSize: 12 }}>内容一致（可能一侧删除）</Typography.Text>
  }
  return (
    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
      {diffs
        .slice(0, 4)
        .map((diff) => `${diff.key}: ${fmt(diff.from)} → ${fmt(diff.to)}`)
        .join('；')}
      {diffs.length > 4 ? ` 等 ${diffs.length} 项` : ''}
    </Typography.Text>
  )
}

function fmt(value: unknown): string {
  if (value === undefined || value === null || value === '') return '空'
  if (Array.isArray(value)) return `[${value.length} 项]`
  const text = String(value)
  return text.length > 12 ? `${text.slice(0, 12)}…` : text
}
