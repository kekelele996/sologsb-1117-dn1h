import { useMemo, useState } from 'react'
import { Alert, Button, Card, Col, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { PlanPointStat, PlanQueueItem, SeasonPlan } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { seasonPlanStore } from '@/stores/seasonPlanStore'
import { checkPlanStale } from '@/utils/planValidity'
import type { StaleReason } from '@/utils/planValidity'

interface CreateFormValues {
  name: string
  orchardIds: string[]
  colonyIds: string[]
}

/** 排季安排：选地块与蜂群 → 按投放点容量排布 → 排队与缺口；依据变动则失效待重算 */
export default function SeasonPlansPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const plans = usePersistentStore(seasonPlanStore, (state) => state.rows)

  const [modalOpen, setModalOpen] = useState(false)
  const [form] = Form.useForm<CreateFormValues>()

  const staleMap = useMemo(() => {
    const map = new Map<string, { validity: 'valid' | 'stale'; reasons: StaleReason[] }>()
    plans.forEach((plan) => {
      map.set(plan.id, checkPlanStale(plan, { orchards, colonies, dropPoints }))
    })
    return map
  }, [plans, orchards, colonies, dropPoints])

  const staleCount = Array.from(staleMap.values()).filter((item) => item.validity === 'stale').length

  function openCreate(): void {
    form.setFieldsValue({
      name: `${new Date().getFullYear()} 季度排布 ${plans.length + 1}`,
      orchardIds: orchards.map((item) => item.id),
      colonyIds: colonies.map((item) => item.id)
    })
    setModalOpen(true)
  }

  async function submit(): Promise<void> {
    const values = await form.validateFields()
    await seasonPlanStore.getState().createPlan(
      {
        name: values.name.trim(),
        orchardIds: values.orchardIds,
        colonyIds: values.colonyIds
      },
      { orchards, colonies, dropPoints }
    )
    message.success('排季安排已生成')
    setModalOpen(false)
  }

  async function recalculate(plan: SeasonPlan): Promise<void> {
    await seasonPlanStore.getState().recalculate(plan.id, { orchards, colonies, dropPoints })
    message.success(`「${plan.name}」已按最新地块花期与投放点容量重算`)
  }

  async function togglePublish(plan: SeasonPlan): Promise<void> {
    await seasonPlanStore.getState().save({ ...plan, status: plan.status === '已发布' ? '草稿' : '已发布' })
    message.success(plan.status === '已发布' ? '已转回草稿' : '方案已标记为已发布')
  }

  async function remove(plan: SeasonPlan): Promise<void> {
    await seasonPlanStore.getState().remove(plan.id)
    message.success('方案已删除')
  }

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">排季安排</h2>
          <p className="page-sub">
            技术员挑好地块与蜂群后，按投放点容量依次排蜂群；排不下的箱数进入排队队列，并标明哪个投放点还差几箱。地块花期或投放点坐标等依据一改动，引用过它的方案立即失效，重算前不能作为可执行方案导出。
          </p>
        </div>
        <Button type="primary" onClick={openCreate}>
          新建排季安排
        </Button>
      </div>

      {staleCount > 0 ? (
        <Alert
          type="warning"
          showIcon
          message={`有 ${staleCount} 份排季安排的引用依据已变动，当前为失效状态，需重算后才能导出执行`}
        />
      ) : plans.length > 0 ? (
        <Alert type="success" showIcon message="所有排季安排依据均未变动，处于可执行状态" />
      ) : null}

      {plans.length === 0 ? (
        <Card size="small">
          <Empty description="还没有排季安排，点击右上角「新建排季安排」开始排布" />
        </Card>
      ) : (
        <Row gutter={[16, 16]}>
          {plans.map((plan) => {
            const stale = staleMap.get(plan.id)
            const isStale = stale?.validity === 'stale'
            return (
              <Col key={plan.id} xs={24}>
                <Card
                  size="small"
                  title={
                    <Space wrap>
                      <span>{plan.name}</span>
                      <Tag color={plan.status === '已发布' ? 'green' : 'default'}>{plan.status}</Tag>
                      <Tag color={isStale ? 'red' : 'blue'}>{isStale ? '失效待重算' : '可执行'}</Tag>
                    </Space>
                  }
                  extra={
                    <Space wrap>
                      <Button size="small" onClick={() => void recalculate(plan)}>
                        重新计算
                      </Button>
                      <Button size="small" onClick={() => void togglePublish(plan)}>
                        {plan.status === '已发布' ? '转为草稿' : '标记发布'}
                      </Button>
                      <Popconfirm title="删除该排季安排？" onConfirm={() => void remove(plan)}>
                        <Button size="small" danger>
                          删除
                        </Button>
                      </Popconfirm>
                    </Space>
                  }
                >
                  <PlanBody plan={plan} stale={isStale} reasons={stale?.reasons ?? []} />
                </Card>
              </Col>
            )
          })}
        </Row>
      )}

      <Modal title="新建排季安排" open={modalOpen} onCancel={() => setModalOpen(false)} onOk={() => void submit()} okText="生成排布" width={640}>
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="方案名称" rules={[{ required: true, message: '请填写方案名称' }]}>
            <Input placeholder="如 2026 年春季排布" />
          </Form.Item>
          <Form.Item name="orchardIds" label="选择地块（按盛花期起从早到晚排布）" rules={[{ required: true, message: '至少选择一个地块' }]}>
            <Select
              mode="multiple"
              optionFilterProp="label"
              options={orchards.map((item) => ({ value: item.id, label: `${item.name}（${item.bloomStart} ~ ${item.bloomEnd}）` }))}
            />
          </Form.Item>
          <Form.Item name="colonyIds" label="选择蜂群（群势强者优先排入）" rules={[{ required: true, message: '至少选择一群蜂' }]}>
            <Select
              mode="multiple"
              optionFilterProp="label"
              options={colonies.map((item) => ({ value: item.id, label: `${item.code}（${item.species} ${item.strengthFrames} 足框）` }))}
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  )
}

/** 方案主体：失效原因 / 汇总 / 投放点排布 / 排队与缺口 */
function PlanBody({ plan, stale, reasons }: { plan: SeasonPlan; stale: boolean; reasons: StaleReason[] }): JSX.Element {
  const totalDemand = plan.orchardsStat.reduce((sum, item) => sum + item.demandBoxes, 0)
  const totalPlaced = plan.assignments.length
  const totalShortage = plan.orchardsStat.reduce((sum, item) => sum + item.unmetBoxes, 0)

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        计算时间 {dayjs(plan.calculatedAt).format('YYYY-MM-DD HH:mm')} · 引用地块 {plan.snapshots.orchards.length} 个 · 投放点{' '}
        {plan.snapshots.dropPoints.length} 个 · 候选蜂群 {plan.snapshots.colonies.length} 群
      </Typography.Text>

      {stale ? (
        <Alert
          type="error"
          showIcon
          message="引用依据已变动，本方案已失效，重算前不能导出为可执行方案"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {reasons.map((reason) => (
                <li key={`${reason.level}-${reason.id}`}>
                  <b>{reason.label}</b>：{reason.detail}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Space wrap>
        <Tag color="blue">建议需求合计 {totalDemand} 箱</Tag>
        <Tag color="green">已排入 {totalPlaced} 箱</Tag>
        <Tag color={totalShortage > 0 ? 'red' : 'default'}>地块缺口合计 {totalShortage} 箱</Tag>
        <Tag color={plan.queue.length > 0 ? 'orange' : 'default'}>排队蜂群 {plan.queue.length} 群</Tag>
      </Space>

      <Table<PlanPointStat>
        size="small"
        pagination={false}
        rowKey="pointId"
        dataSource={plan.pointsStat}
        title={() => '投放点排布（容量 / 已排 / 还差几箱）'}
        columns={[
          { title: '地块', dataIndex: 'orchardName', key: 'orchard', width: 140 },
          { title: '投放点', dataIndex: 'pointCode', key: 'code', width: 90 },
          {
            title: '容量 / 已排',
            key: 'usage',
            width: 110,
            render: (_, record) => `${record.colonyCodes.length} / ${record.capacityBoxes} 箱`
          },
          {
            title: '还差',
            dataIndex: 'shortageBoxes',
            key: 'shortage',
            width: 90,
            render: (value: number) => (value > 0 ? <Tag color="red">差 {value} 箱</Tag> : <Tag color="green">已满</Tag>)
          },
          {
            title: '排入群号',
            key: 'codes',
            render: (_, record) => (record.colonyCodes.length > 0 ? record.colonyCodes.join('、') : '—')
          }
        ]}
      />

      <Row gutter={16}>
        <Col xs={24} lg={12}>
          <Card size="small" title={`排队蜂群（${plan.queue.length} 群，排不下先排队）`}>
            {plan.queue.length === 0 ? (
              <Typography.Text type="secondary">候选蜂群均已排入，没有排队。</Typography.Text>
            ) : (
              <Table<PlanQueueItem>
                size="small"
                pagination={false}
                rowKey="colonyId"
                dataSource={plan.queue}
                columns={[
                  { title: '群号', dataIndex: 'colonyCode', key: 'code', width: 90 },
                  { title: '意图地块', dataIndex: 'intendedOrchardName', key: 'orchard' },
                  {
                    title: '排队原因',
                    dataIndex: 'reason',
                    key: 'reason',
                    width: 110,
                    render: (value: PlanQueueItem['reason']) => (
                      <Tag color={value === '容量已满' ? 'orange' : 'volcano'}>{value}</Tag>
                    )
                  }
                ]}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card size="small" title="地块需求与缺口（说清哪个点还差几箱）">
            <Space direction="vertical" style={{ width: '100%' }} size={6}>
              {plan.orchardsStat.map((stat) => (
                <div key={stat.orchardId} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                  <span>
                    <b>{stat.orchardName}</b>
                    <Typography.Text type="secondary" style={{ fontSize: 12, marginLeft: 6 }}>
                      建议 {stat.demandBoxes} · 容量 {stat.capacityBoxes} · 已排 {stat.placedBoxes}
                    </Typography.Text>
                  </span>
                  {stat.unmetBoxes > 0 ? <Tag color="red">还差 {stat.unmetBoxes} 箱</Tag> : <Tag color="green">满足</Tag>}
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>
    </Space>
  )
}
