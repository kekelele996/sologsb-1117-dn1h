import { useEffect, useMemo, useState } from 'react'
import { Alert, Button, Card, Radio, Select, Space, Table, Tag, Typography, message } from 'antd'
import dayjs from 'dayjs'
import type { SeasonPlan } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { seasonPlanStore } from '@/stores/seasonPlanStore'
import { checkPlanStale } from '@/utils/planValidity'
import { downloadCsv, downloadJson } from '@/utils/export'

interface PlanExecutionRow {
  plan: string
  validity: string
  orchard: string
  bloom: string
  point: string
  capacityBoxes: number
  placedBoxes: number
  shortageBoxes: number
  colonyCode: string
  window: string
}

interface QueueExportRow {
  plan: string
  validity: string
  orchard: string
  point: string
  shortageBoxes: number | ''
  colonyCode: string
  reason: string
}

/** 导出与打印：只有重算有效的排季安排才能作为可执行方案导出；原始数据备份不受限 */
export default function ExportPage(): JSX.Element {
  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const plans = usePersistentStore(seasonPlanStore, (state) => state.rows)
  const [orientation, setOrientation] = useState<'portrait' | 'landscape'>('landscape')
  const [selectedPlanId, setSelectedPlanId] = useState<string | undefined>(plans[0]?.id)

  // 方案删除后回退到最新一份
  useEffect(() => {
    if (plans.length === 0) {
      setSelectedPlanId(undefined)
    } else if (!plans.some((item) => item.id === selectedPlanId)) {
      setSelectedPlanId(plans[0].id)
    }
  }, [plans, selectedPlanId])

  const effectivePlanId = selectedPlanId ?? plans[0]?.id
  const plan: SeasonPlan | undefined = plans.find((item) => item.id === effectivePlanId)

  const stale = useMemo(
    () => (plan ? checkPlanStale(plan, { orchards, colonies, dropPoints }) : undefined),
    [plan, orchards, colonies, dropPoints]
  )
  const isStale = stale?.validity === 'stale'

  const orchardName = (id: string): string => orchards.find((item) => item.id === id)?.name ?? '未知地块'

  const executionRows = useMemo<PlanExecutionRow[]>(() => {
    if (!plan) return []
    const rows: PlanExecutionRow[] = []
    const validityText = stale?.validity === 'stale' ? '失效待重算' : '可执行'
    plan.orchardsStat.forEach((stat) => {
      const points = plan.pointsStat.filter((item) => item.orchardId === stat.orchardId)
      points.forEach((point) => {
        const window = dropPoints.find((item) => item.id === point.pointId)
        const windowText = window ? `${window.dropWindow} ~ ${window.withdrawTime}` : '—'
        if (point.colonyCodes.length === 0) {
          rows.push({
            plan: plan.name,
            validity: validityText,
            orchard: stat.orchardName,
            bloom: `${stat.bloomStart} ~ ${stat.bloomEnd}`,
            point: point.pointCode,
            capacityBoxes: point.capacityBoxes,
            placedBoxes: 0,
            shortageBoxes: point.shortageBoxes,
            colonyCode: '（空点）',
            window: windowText
          })
          return
        }
        point.colonyCodes.forEach((code) => {
          rows.push({
            plan: plan.name,
            validity: validityText,
            orchard: stat.orchardName,
            bloom: `${stat.bloomStart} ~ ${stat.bloomEnd}`,
            point: point.pointCode,
            capacityBoxes: point.capacityBoxes,
            placedBoxes: point.colonyCodes.length,
            shortageBoxes: point.shortageBoxes,
            colonyCode: code,
            window: windowText
          })
        })
      })
    })
    return rows
  }, [plan, stale, dropPoints])

  const queueRows = useMemo<QueueExportRow[]>(() => {
    if (!plan) return []
    const validityText = stale?.validity === 'stale' ? '失效待重算' : '可执行'
    const rows: QueueExportRow[] = plan.queue.map((item) => ({
      plan: plan.name,
      validity: validityText,
      orchard: item.intendedOrchardName,
      point: '（各地块投放点均排不下）',
      shortageBoxes: '',
      colonyCode: item.colonyCode,
      reason: item.reason
    }))
    plan.pointsStat
      .filter((item) => item.shortageBoxes > 0)
      .forEach((item) => {
        rows.push({
          plan: plan.name,
          validity: validityText,
          orchard: item.orchardName,
          point: item.pointCode,
          shortageBoxes: item.shortageBoxes,
          colonyCode: '',
          reason: '投放点容量缺口'
        })
      })
    return rows
  }, [plan, stale])

  function guardStale(): boolean {
    if (!plan) {
      message.warning('请先在「排季安排」页生成方案')
      return true
    }
    if (isStale) {
      message.error('该方案引用的地块花期或投放点坐标等已变动，已失效；请先重新计算，再导出执行方案')
      return true
    }
    return false
  }

  function exportExecution(): void {
    if (guardStale()) return
    downloadCsv('可执行授粉安排.csv', executionRows as unknown as Record<string, unknown>[], [
      { key: 'plan', label: '方案' },
      { key: 'validity', label: '有效性' },
      { key: 'orchard', label: '地块' },
      { key: 'bloom', label: '盛花期' },
      { key: 'point', label: '投放点' },
      { key: 'capacityBoxes', label: '容量(箱)' },
      { key: 'placedBoxes', label: '已排(箱)' },
      { key: 'shortageBoxes', label: '还差(箱)' },
      { key: 'colonyCode', label: '群号' },
      { key: 'window', label: '投放时间窗' }
    ])
    message.success('可执行授粉安排已导出')
  }

  function exportQueue(): void {
    if (guardStale()) return
    downloadCsv('排队与缺口清单.csv', queueRows as unknown as Record<string, unknown>[], [
      { key: 'plan', label: '方案' },
      { key: 'validity', label: '有效性' },
      { key: 'orchard', label: '地块' },
      { key: 'point', label: '投放点' },
      { key: 'shortageBoxes', label: '差几箱' },
      { key: 'colonyCode', label: '排队群号' },
      { key: 'reason', label: '原因' }
    ])
    message.success('排队与缺口清单已导出')
  }

  /** 全量 JSON 备份属于数据备份，不要求方案有效 */
  function exportBackup(): void {
    downloadJson('gbbeeroute-backup.json', {
      exportedAt: new Date().toISOString(),
      orchards,
      colonies,
      dropPoints,
      routes,
      seasonPlans: plans
    })
    message.success('全量数据已导出为 JSON 备份')
  }

  const routeRows = useMemo(
    () =>
      routes.map((route) => {
        const from = dropPoints.find((item) => item.id === route.fromDropId)
        const to = dropPoints.find((item) => item.id === route.toDropId)
        return {
          from: from ? `${from.code}（${orchardName(from.orchardId)}）` : '—',
          to: to ? `${to.code}（${orchardName(to.orchardId)}）` : '—',
          distanceKm: route.distanceKm,
          durationH: route.durationH,
          vehicleType: route.vehicleType,
          departAt: route.departAt,
          riskNote: route.riskNote || '—'
        }
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [routes, dropPoints, orchards]
  )

  function exportRoutes(): void {
    downloadCsv('转场路线表.csv', routeRows as unknown as Record<string, unknown>[], [
      { key: 'from', label: '出发投放点' },
      { key: 'to', label: '到达投放点' },
      { key: 'distanceKm', label: '里程(km)' },
      { key: 'durationH', label: '预计耗时(h)' },
      { key: 'vehicleType', label: '车辆' },
      { key: 'departAt', label: '出发时刻' },
      { key: 'riskNote', label: '途中风险' }
    ])
    message.success('转场路线表已导出')
  }

  return (
    <div className="page">
      <style>{`@page { size: A4 ${orientation}; margin: 10mm; }`}</style>
      <div className="page-head">
        <div>
          <h2 className="page-title">导出与打印</h2>
          <p className="page-sub">
            只有「可执行」状态的排季安排才能导出为执行方案；依据已变动的失效方案必须先重新计算。全量 JSON 备份与转场路线表不受此限制。
          </p>
        </div>
        <Space>
          <Radio.Group value={orientation} onChange={(event) => setOrientation(event.target.value)}>
            <Radio.Button value="portrait">纵向打印</Radio.Button>
            <Radio.Button value="landscape">横向打印</Radio.Button>
          </Radio.Group>
          <Button onClick={() => window.print()}>打印视图</Button>
        </Space>
      </div>

      <Card size="small" title="选择排季安排">
        <Space wrap>
          <Select
            style={{ minWidth: 320 }}
            value={effectivePlanId}
            onChange={setSelectedPlanId}
            options={plans.map((item) => ({ value: item.id, label: item.name }))}
            placeholder="暂无排季安排"
          />
          {plan ? <Tag color={isStale ? 'red' : 'green'}>{isStale ? '失效待重算' : '可执行'}</Tag> : <Tag>无方案</Tag>}
        </Space>
      </Card>

      {plan && isStale ? (
        <Alert
          type="error"
          showIcon
          message="该方案已失效，重算前不能作为可执行方案导出"
          description={
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {(stale?.reasons ?? []).map((reason) => (
                <li key={`${reason.level}-${reason.id}`}>
                  <b>{reason.label}</b>：{reason.detail}
                </li>
              ))}
            </ul>
          }
        />
      ) : null}

      <Card size="small">
        <Space wrap>
          <Button type="primary" disabled={!plan || isStale} onClick={exportExecution}>
            导出可执行授粉安排（CSV）
          </Button>
          <Button disabled={!plan || isStale} onClick={exportQueue}>
            导出排队与缺口清单（CSV）
          </Button>
          <Button onClick={exportRoutes}>导出转场路线表（CSV）</Button>
          <Button onClick={exportBackup}>导出全量 JSON 备份</Button>
          <Tag>地块 {orchards.length}</Tag>
          <Tag>蜂群 {colonies.length}</Tag>
          <Tag>投放点 {dropPoints.length}</Tag>
          <Tag>路线 {routes.length}</Tag>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            生成时间 {dayjs().format('YYYY-MM-DD HH:mm')}
          </Typography.Text>
        </Space>
      </Card>

      <div className={orientation === 'landscape' ? 'print-landscape' : 'print-portrait'}>
        <Card size="small" title={`可执行授粉安排（${executionRows.length} 行）${isStale ? ' · 当前为失效方案，禁止导出' : ''}`} style={{ marginBottom: 16 }}>
          <Table<PlanExecutionRow>
            dataSource={executionRows}
            rowKey={(record, index) => `${record.point}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '地块', dataIndex: 'orchard', key: 'orchard' },
              { title: '盛花期', dataIndex: 'bloom', key: 'bloom' },
              { title: '投放点', dataIndex: 'point', key: 'point', width: 90 },
              { title: '容量', dataIndex: 'capacityBoxes', key: 'cap', width: 70 },
              { title: '已排', dataIndex: 'placedBoxes', key: 'placed', width: 70 },
              {
                title: '还差',
                dataIndex: 'shortageBoxes',
                key: 'short',
                width: 80,
                render: (value: number) => (value > 0 ? <Tag color="red">差 {value}</Tag> : '—')
              },
              { title: '群号', dataIndex: 'colonyCode', key: 'colony', width: 100 },
              { title: '投放时间窗', dataIndex: 'window', key: 'window' }
            ]}
          />
        </Card>

        <Card size="small" title={`排队与缺口（排队 ${plan?.queue.length ?? 0} 群）`} style={{ marginBottom: 16 }}>
          <Table<QueueExportRow>
            dataSource={queueRows}
            rowKey={(record, index) => `${record.point}-${record.colonyCode}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '地块', dataIndex: 'orchard', key: 'orchard' },
              { title: '投放点', dataIndex: 'point', key: 'point' },
              {
                title: '差几箱',
                dataIndex: 'shortageBoxes',
                key: 'shortage',
                width: 80,
                render: (value: number | '') => (value ? <Tag color="red">{value}</Tag> : '—')
              },
              { title: '排队群号', dataIndex: 'colonyCode', key: 'code', width: 100, render: (value: string) => value || '—' },
              { title: '原因', dataIndex: 'reason', key: 'reason' }
            ]}
          />
        </Card>

        <Card size="small" title={`转场路线表（${routeRows.length} 段）`}>
          <Table
            dataSource={routeRows}
            rowKey={(record, index) => `${record.from}-${record.to}-${index ?? 0}`}
            size="small"
            pagination={false}
            columns={[
              { title: '出发投放点', dataIndex: 'from', key: 'from' },
              { title: '到达投放点', dataIndex: 'to', key: 'to' },
              { title: '里程(km)', dataIndex: 'distanceKm', key: 'km', width: 100 },
              { title: '耗时(h)', dataIndex: 'durationH', key: 'hour', width: 90 },
              { title: '车辆', dataIndex: 'vehicleType', key: 'vehicle', width: 100 },
              { title: '出发时刻', dataIndex: 'departAt', key: 'depart' },
              { title: '途中风险', dataIndex: 'riskNote', key: 'risk' }
            ]}
          />
        </Card>
      </div>
    </div>
  )
}
