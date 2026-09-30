import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Checkbox,
  Col,
  Empty,
  Form,
  Input,
  Modal,
  Row,
  Segmented,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography,
  message
} from 'antd'
import type { ColumnsType } from 'antd/es/table'
import type { BeeColony, Orchard, PlanGap, PlanPlacement, SeasonPlan } from '@/types'
import { arrangePlan, planFingerprint } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { planStore } from '@/stores/planStore'
import { downloadCsv } from '@/utils/export'
import { uid } from '@/utils/id'

/** 排季安排：挑地块与蜂群，按投放点容量自动排蜂，排队 + 缺口一目了然；花期/坐标变动后失效需重算 */
export default function PlanPage(): JSX.Element {
  const plans = usePersistentStore(planStore, (state) => state.rows)
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)

  const [activeId, setActiveId] = useState<string | null>(plans[0]?.id ?? null)
  const [createOpen, setCreateOpen] = useState(false)
  const [planName, setPlanName] = useState('')
  const [selectedOrchardIds, setSelectedOrchardIds] = useState<string[]>([])
  const [selectedColonyIds, setSelectedColonyIds] = useState<string[]>([])

  const activePlan = plans.find((item) => item.id === activeId)

  const orchardName = (id: string): string => orchards.find((item) => item.id === id)?.name ?? '未知地块'
  const dropCode = (id: string): string => dropPoints.find((item) => item.id === id)?.code ?? '—'

  const placementColumns: ColumnsType<PlanPlacement> = useMemo(
    () => [
      { title: '群号', dataIndex: 'colonyCode', key: 'code', width: 100 },
      { title: '安排到地块', key: 'orchard', render: (_, record) => orchardName(record.orchardId) },
      { title: '投放点', key: 'drop', width: 120, render: (_, record) => dropCode(record.dropPointId) }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orchards, dropPoints]
  )

  const dropGapColumns: ColumnsType<PlanGap> = useMemo(
    () => [
      { title: '投放点', dataIndex: 'dropCode', key: 'code', width: 100 },
      { title: '所属地块', key: 'orchard', render: (_, record) => orchardName(record.orchardId) },
      { title: '可容纳（箱）', dataIndex: 'capacity', key: 'cap', width: 110 },
      { title: '已放（箱）', dataIndex: 'placed', key: 'placed', width: 100 },
      {
        title: '还差（箱）',
        key: 'short',
        width: 110,
        render: (_, record) =>
          record.shortBy > 0 ? <Tag color="orange">还差 {record.shortBy} 箱</Tag> : <Tag color="green">已满</Tag>
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orchards]
  )

  const orchardGapColumns = useMemo(
    () => [
      { title: '地块', key: 'orchard', render: (_: unknown, record: { orchardId: string }) => orchardName(record.orchardId) },
      { title: '建议（箱）', dataIndex: 'need', key: 'need', width: 110 },
      { title: '已放（箱）', dataIndex: 'placed', key: 'placed', width: 100 },
      {
        title: '授粉缺口',
        key: 'short',
        width: 120,
        render: (_: unknown, record: { shortBy: number }) =>
          record.shortBy > 0 ? <Tag color="red">缺 {record.shortBy} 箱</Tag> : <Tag color="green">已满足</Tag>
      }
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [orchards]
  )

  function openCreate(): void {
    setPlanName(`${new Date().getFullYear()} 排季安排`)
    setSelectedOrchardIds(orchards.map((item) => item.id))
    setSelectedColonyIds(colonies.map((item) => item.id))
    setCreateOpen(true)
  }

  async function handleCreate(): Promise<void> {
    if (selectedOrchardIds.length === 0) {
      message.warning('请先选择地块')
      return
    }
    if (selectedColonyIds.length === 0) {
      message.warning('请先选择蜂群')
      return
    }
    const result = arrangePlan(selectedOrchardIds, selectedColonyIds, orchards, colonies, dropPoints)
    const now = new Date().toISOString()
    const plan: SeasonPlan = {
      id: uid('plan'),
      name: planName.trim() || '未命名排季安排',
      createdAt: now,
      updatedAt: now,
      orchardIds: selectedOrchardIds,
      colonyIds: selectedColonyIds,
      placements: result.placements,
      queue: result.queue,
      dropGaps: result.dropGaps,
      orchardGaps: result.orchardGaps,
      status: 'valid',
      fingerprint: planFingerprint(selectedOrchardIds, orchards, dropPoints)
    }
    await planStore.getState().save(plan)
    setActiveId(plan.id)
    setCreateOpen(false)
    message.success(`已生成排季安排：${result.placements.length} 群已安排，${result.queue.length} 群排队`)
  }

  async function handleRecalculate(): Promise<void> {
    if (!activePlan) return
    await planStore.getState().recalculate(activePlan.id)
    message.success('已按当前地块花期与投放点坐标/容量重算')
  }

  async function handleDelete(): Promise<void> {
    if (!activePlan) return
    await planStore.getState().remove(activePlan.id)
    setActiveId(plans.find((item) => item.id !== activePlan.id)?.id ?? null)
    message.success('排季安排已删除')
  }

  function handleExport(): void {
    if (!activePlan) return
    if (activePlan.status === 'invalid') {
      message.error('方案已失效，请重算后再导出为可执行方案')
      return
    }
    const rows: Record<string, unknown>[] = []
    activePlan.dropGaps.forEach((gap) => {
      const codes = activePlan.placements.filter((item) => item.dropPointId === gap.dropPointId).map((item) => item.colonyCode)
      rows.push({
        orchard: orchardName(gap.orchardId),
        dropCode: gap.dropCode,
        capacity: gap.capacity,
        placed: gap.placed,
        shortBy: gap.shortBy > 0 ? gap.shortBy : '—',
        colonyCodes: codes.length > 0 ? codes.join('、') : '待分配',
        note: gap.shortBy > 0 ? `还可再放 ${gap.shortBy} 箱` : ''
      })
    })
    activePlan.queue.forEach((item) => {
      rows.push({
        orchard: '—',
        dropCode: '排队',
        capacity: '',
        placed: '',
        shortBy: '',
        colonyCodes: item.colonyCode,
        note: item.reason
      })
    })
    downloadCsv(`${activePlan.name}.csv`, rows, [
      { key: 'orchard', label: '地块' },
      { key: 'dropCode', label: '投放点/排队' },
      { key: 'capacity', label: '容量' },
      { key: 'placed', label: '已放' },
      { key: 'shortBy', label: '还差' },
      { key: 'colonyCodes', label: '安排群号' },
      { key: 'note', label: '备注' }
    ])
    message.success('排季安排已导出')
  }

  const invalid = activePlan?.status === 'invalid'

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">排季安排</h2>
          <p className="page-sub">
            挑好地块与蜂群后按投放点容量自动排蜂：排不下的蜂群先排队，并标明哪个点还差几箱。
            地块花期或投放点坐标/容量一改动，引用它的安排即失效，需重算后才能作为可执行方案导出。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建排季安排
        </Button>
      </div>

      {plans.length === 0 ? (
        <Empty description="暂无排季安排，点击右上角「新建排季安排」开始" />
      ) : (
        <>
          <Card size="small">
            <Space wrap>
              <Segmented
                value={activeId}
                onChange={(value) => setActiveId(value as string)}
                options={plans.map((item) => ({ label: item.name, value: item.id }))}
              />
              {activePlan ? (
                invalid ? (
                  <Tag color="red">方案已失效</Tag>
                ) : (
                  <Tag color="green">方案有效</Tag>
                )
              ) : null}
            </Space>
          </Card>

          {activePlan ? (
            <>
              {invalid ? (
                <Alert
                  type="warning"
                  showIcon
                  message="本安排已失效：地块花期或投放点坐标/容量发生变化"
                  description="失效期间不可导出为可执行方案。请重算后再导出。"
                  action={
                    <Button size="small" type="primary" onClick={() => void handleRecalculate()}>
                      重算方案
                    </Button>
                  }
                />
              ) : null}

              <Row gutter={16}>
                <Col xs={24} xl={14}>
                  <Card size="small" title={`已安排（${activePlan.placements.length} 群）`}>
                    <Table<PlanPlacement>
                      dataSource={activePlan.placements}
                      rowKey={(record) => `${record.colonyId}-${record.dropPointId}`}
                      size="small"
                      pagination={false}
                      columns={placementColumns}
                      locale={{ emptyText: '尚未安排任何蜂群' }}
                    />
                  </Card>
                </Col>
                <Col xs={24} xl={10}>
                  <Card size="small" title={`排队（${activePlan.queue.length} 群排不下）`}>
                    {activePlan.queue.length === 0 ? (
                      <Typography.Text type="secondary">全部蜂群均已安排，无排队</Typography.Text>
                    ) : (
                      <Space direction="vertical" size={6} style={{ width: '100%' }}>
                        {activePlan.queue.map((item) => (
                          <div key={item.colonyId} style={{ padding: '6px 10px', border: '1px dashed #cfd9e2', borderRadius: 8 }}>
                            <Tag color="gold">{item.colonyCode}</Tag>
                            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                              {item.reason}
                            </Typography.Text>
                          </div>
                        ))}
                      </Space>
                    )}
                  </Card>
                </Col>
              </Row>

              <Card size="small" title="投放点缺口（哪个点还差几箱）">
                <Table<PlanGap>
                  dataSource={activePlan.dropGaps}
                  rowKey="dropPointId"
                  size="small"
                  pagination={false}
                  columns={dropGapColumns}
                  locale={{ emptyText: '所选地块暂无投放点' }}
                />
              </Card>

              <Card size="small" title="地块授粉缺口（建议箱数是否满足）">
                <Table
                  dataSource={activePlan.orchardGaps}
                  rowKey="orchardId"
                  size="small"
                  pagination={false}
                  columns={orchardGapColumns}
                />
              </Card>

              <Card size="small" title="方案操作">
                <Space wrap>
                  <Button onClick={() => void handleRecalculate()}>重算方案</Button>
                  <Tooltip title={invalid ? '方案已失效，请重算后再导出' : '导出为可执行的排季安排 CSV'}>
                    <Button type="primary" onClick={handleExport} disabled={invalid}>
                      导出排季安排（CSV）
                    </Button>
                  </Tooltip>
                  <Button danger onClick={() => void handleDelete()}>
                    删除方案
                  </Button>
                  <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                    最近重算：{new Date(activePlan.updatedAt).toLocaleString('zh-CN')}
                  </Typography.Text>
                </Space>
              </Card>
            </>
          ) : null}
        </>
      )}

      <Modal title="新建排季安排" open={createOpen} onCancel={() => setCreateOpen(false)} onOk={() => void handleCreate()} okText="生成安排" width={720}>
        <Form layout="vertical">
          <Form.Item label="方案名称">
            <Input value={planName} onChange={(event) => setPlanName(event.target.value)} placeholder="如 2026 春播安排" />
          </Form.Item>
          <Form.Item label="选择地块（花期与投放点参与排季）">
            <Checkbox.Group
              value={selectedOrchardIds}
              onChange={(values) => setSelectedOrchardIds(values as string[])}
              options={orchards.map((item: Orchard) => ({
                value: item.id,
                label: `${item.name}（${item.crop} · 建议 ${Math.ceil(item.areaMu * item.colonyIntensity) || 1} 箱）`
              }))}
            />
          </Form.Item>
          <Form.Item label="选择蜂群（按群号安排到投放点）">
            <Checkbox.Group
              value={selectedColonyIds}
              onChange={(values) => setSelectedColonyIds(values as string[])}
              options={colonies.map((item: BeeColony) => ({
                value: item.id,
                label: `${item.code}（${item.species} · ${item.strengthFrames} 足框 · ${item.status}）`
              }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}
