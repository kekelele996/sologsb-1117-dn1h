import { useMemo, useState } from 'react'
import {
  Alert,
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Input,
  Radio,
  Row,
  Space,
  Statistic,
  Table,
  Tag,
  Typography,
  Upload,
  message
} from 'antd'
import type { UploadProps } from 'antd'
import {
  CheckCircleOutlined,
  CloudUploadOutlined,
  ExclamationCircleOutlined,
  MinusCircleOutlined,
  PlusCircleOutlined,
  SwapOutlined
} from '@ant-design/icons'
import type { BeeColony, DropPoint, Orchard, SeasonPlan, TransitRoute } from '@/types'
import { usePersistentStore } from '@/hooks/usePersistentStore'
import { db } from '@/hooks/usePersistentStore'
import { orchardStore } from '@/stores/orchardStore'
import { colonyStore } from '@/stores/colonyStore'
import { droppointStore } from '@/stores/droppointStore'
import { routeStore } from '@/stores/routeStore'
import { planStore } from '@/stores/planStore'
import {
  buildMergedRows,
  computeMerge,
  diffFields,
  TABLE_LABELS,
  type MergeResult,
  type MergeRow,
  type Resolution,
  type Snapshot,
  type TableKey
} from '@/utils/merge'
import { downloadJson } from '@/utils/export'
import type { ColumnsType } from 'antd/es/table'

const FIELD_LABELS: Record<string, string> = {
  name: '名称',
  code: '编号',
  crop: '作物',
  areaMu: '面积',
  longitude: '经度',
  latitude: '纬度',
  bloomStart: '盛花期起',
  bloomEnd: '盛花期止',
  colonyIntensity: '需蜂强度',
  ownerContact: '联系方式',
  accessibility: '可达性',
  historyYears: '历史年份',
  note: '备注',
  species: '蜂种',
  strengthFrames: '群势',
  boxType: '箱型',
  currentOrchardId: '当前地块',
  status: '状态',
  lastCheckDate: '最近检查',
  healthNote: '健康备注',
  orchardId: '所属地块',
  capacityBoxes: '可容纳箱数',
  shade: '遮阴',
  waterDistance: '水源距离',
  dropWindow: '投放窗',
  withdrawTime: '撤场时间',
  owner: '责任人',
  colonyCodes: '安排群号',
  fromDropId: '出发投放点',
  toDropId: '到达投放点',
  distanceKm: '里程',
  durationH: '耗时',
  vehicleType: '车辆',
  departAt: '出发时刻',
  riskNote: '风险备注',
  actualNote: '实际记录',
  orchardIds: '地块',
  colonyIds: '蜂群',
  placements: '安排',
  queue: '排队',
  dropGaps: '投放点缺口',
  orchardGaps: '地块缺口',
  fingerprint: '指纹'
}

function fieldLabel(key: string): string {
  return FIELD_LABELS[key] ?? key
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—'
  if (Array.isArray(value)) return value.length > 0 ? value.join('、') : '—'
  if (typeof value === 'object') return JSON.stringify(value)
  return String(value)
}

/** 离线合并：外勤导出离线包，回驻地按编号合并；两边都动过的先列出来复核 */
export default function MergePage(): JSX.Element {
  const [device, setDevice] = useState('外勤手机')
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [merge, setMerge] = useState<MergeResult | null>(null)
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({})
  const [applying, setApplying] = useState(false)

  const orchards = usePersistentStore(orchardStore, (state) => state.rows)
  const colonies = usePersistentStore(colonyStore, (state) => state.rows)
  const dropPoints = usePersistentStore(droppointStore, (state) => state.rows)
  const routes = usePersistentStore(routeStore, (state) => state.rows)
  const plans = usePersistentStore(planStore, (state) => state.rows)

  const localData = useMemo<Record<TableKey, Record<string, unknown>[]>>(
    () => ({
      orchards: orchards as unknown as Record<string, unknown>[],
      colonies: colonies as unknown as Record<string, unknown>[],
      dropPoints: dropPoints as unknown as Record<string, unknown>[],
      routes: routes as unknown as Record<string, unknown>[],
      plans: plans as unknown as Record<string, unknown>[]
    }),
    [orchards, colonies, dropPoints, routes, plans]
  )

  function exportSnapshot(): void {
    const snap: Snapshot = {
      app: 'gbbeeroute-merge',
      exportedAt: new Date().toISOString(),
      device: device.trim() || '外勤设备',
      schemaVersion: 3,
      data: { orchards, colonies, dropPoints, routes, plans }
    }
    downloadJson(`gbbeeroute-离线包-${new Date().toISOString().slice(0, 10)}.json`, snap)
    message.success('离线包已导出，外勤可带出')
  }

  const uploadProps: UploadProps = {
    accept: 'application/json,.json',
    showUploadList: false,
    beforeUpload: (file) => {
      const reader = new FileReader()
      reader.onload = () => {
        try {
          const parsed = JSON.parse(String(reader.result)) as Snapshot
          if (!parsed.app || !parsed.data) {
            message.error('文件格式不正确：缺少 app 或 data 字段')
            return
          }
          setSnapshot(parsed)
          const result = computeMerge(parsed, localData)
          setMerge(result)
          // 默认全部采用外勤版（外勤离线改的是新活儿）
          const defaults: Record<string, Resolution> = {}
          result.conflicts.forEach((row) => {
            defaults[`${row.table}:${row.id}`] = 'field'
          })
          setResolutions(defaults)
          message.success(`已读取离线包：外勤新增 ${result.newFromField.length} 条，本地新增 ${result.newAtLocal.length} 条，一致 ${result.identical.length} 条，冲突 ${result.conflicts.length} 条`)
        } catch {
          message.error('解析失败：请确认是本系统导出的离线包 JSON')
        }
      }
      reader.readAsText(file)
      return false
    }
  }

  async function applyMerge(): Promise<void> {
    if (!merge) return
    setApplying(true)
    try {
      const merged = buildMergedRows(merge, resolutions)
      await db.orchards.bulkPut(merged.orchards as unknown as Orchard[])
      await db.colonies.bulkPut(merged.colonies as unknown as BeeColony[])
      await db.dropPoints.bulkPut(merged.dropPoints as unknown as DropPoint[])
      await db.routes.bulkPut(merged.routes as unknown as TransitRoute[])
      if (merged.plans.length > 0) await db.plans.bulkPut(merged.plans as unknown as SeasonPlan[])
      await Promise.all([
        orchardStore.getState().hydrate(),
        colonyStore.getState().hydrate(),
        droppointStore.getState().hydrate(),
        routeStore.getState().hydrate(),
        planStore.getState().hydrate()
      ])
      message.success('合并完成，数据已写回本地')
      setSnapshot(null)
      setMerge(null)
      setResolutions({})
    } finally {
      setApplying(false)
    }
  }

  const conflictColumns: ColumnsType<MergeRow> = [
    { title: '表', dataIndex: 'table', key: 'table', width: 110, render: (table: TableKey) => TABLE_LABELS[table] ?? table },
    { title: '编号', dataIndex: 'id', key: 'id', width: 140 },
    {
      title: '两边差异',
      key: 'diff',
      render: (_: unknown, record: MergeRow) => {
        if (!record.field || !record.local) return '—'
        const fields = diffFields(record.field, record.local)
        return (
          <Space wrap size={4}>
            {fields.map((key) => (
              <Tag key={key} color="red">
                {fieldLabel(key)}
              </Tag>
            ))}
          </Space>
        )
      }
    },
    {
      title: '复核选择',
      key: 'resolution',
      width: 260,
      render: (_: unknown, record: MergeRow) => (
        <Radio.Group
          value={resolutions[`${record.table}:${record.id}`] ?? 'field'}
          onChange={(event) =>
            setResolutions((prev) => ({ ...prev, [`${record.table}:${record.id}`]: event.target.value as Resolution }))
          }
          optionType="button"
          buttonStyle="solid"
          size="small"
          options={[
            { label: '采用外勤版', value: 'field' },
            { label: '保留本地版', value: 'local' }
          ]}
        />
      )
    }
  ]

  return (
    <div className="page">
      <div className="page-head">
        <div>
          <h2 className="page-title">离线合并</h2>
          <p className="page-sub">
            外勤在无网环境改完数据，回驻地后导出离线包并按编号合并。两边都动过的行先列出来复核，确认采用哪一版后再写回。
          </p>
        </div>
      </div>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card size="small" title="1. 外勤带出离线包">
            <Space wrap>
              <Input
                addonBefore="设备标识"
                value={device}
                onChange={(event) => setDevice(event.target.value)}
                style={{ width: 200 }}
                placeholder="如 外勤手机"
              />
              <Button type="primary" icon={<CloudUploadOutlined />} onClick={exportSnapshot}>
                导出离线包
              </Button>
            </Space>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              离线包包含地块、蜂群、投放点、转场路线与排季安排，外勤可在无网时对照修改。
            </Typography.Paragraph>
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card size="small" title="2. 回驻地导入并合并">
            <Upload {...uploadProps}>
              <Button icon={<SwapOutlined />}>选择离线包 JSON 导入</Button>
            </Upload>
            <Typography.Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
              导入后按编号逐行比对：一致的直接合并，两边都改过的进入复核清单。
            </Typography.Paragraph>
          </Card>
        </Col>
      </Row>

      {snapshot && merge ? (
        <>
          <Card size="small" title="合并概览">
            <Row gutter={16}>
              <Col span={6}>
                <Statistic title="外勤新增" value={merge.newFromField.length} valueStyle={{ color: '#3f7a4d' }} prefix={<PlusCircleOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic title="本地新增" value={merge.newAtLocal.length} valueStyle={{ color: '#2f6f8f' }} prefix={<PlusCircleOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic title="两边一致" value={merge.identical.length} valueStyle={{ color: '#7f8d82' }} prefix={<CheckCircleOutlined />} />
              </Col>
              <Col span={6}>
                <Statistic title="冲突待复核" value={merge.conflicts.length} valueStyle={{ color: '#c0392b' }} prefix={<ExclamationCircleOutlined />} />
              </Col>
            </Row>
            {snapshot.device ? (
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                离线包设备：{snapshot.device} · 导出时间：{new Date(snapshot.exportedAt).toLocaleString('zh-CN')}
              </Typography.Text>
            ) : null}
          </Card>

          {merge.conflicts.length > 0 ? (
            <Alert
              type="error"
              showIcon
              message={`${merge.conflicts.length} 行两边都改过，请先复核采用哪一版`}
              description="复核清单按「两边都动过」优先列出；未列在冲突中的行将按规则自动合并。"
            />
          ) : (
            <Alert type="success" showIcon message="没有两边都改过的行，可直接合并" />
          )}

          {merge.conflicts.length > 0 ? (
            <Card size="small" title={`复核清单（两边都改过 · ${merge.conflicts.length} 行）`}>
              <Table
                dataSource={merge.conflicts}
                rowKey={(record) => `${record.table}-${record.id}`}
                size="small"
                pagination={false}
                columns={conflictColumns}
                expandable={{
                  expandedRowRender: (record) => {
                    if (!record.field || !record.local) return null
                    const field = record.field
                    const local = record.local
                    const diffKeys = diffFields(field, local)
                    return (
                      <Row gutter={16}>
                        <Col span={12}>
                          <Card size="small" title="外勤版（离线包）" type="inner">
                            <Descriptions size="small" column={1} colon>
                              {diffKeys.map((key) => (
                                <Descriptions.Item key={key} label={fieldLabel(key)}>
                                  {displayValue(field[key])}
                                </Descriptions.Item>
                              ))}
                            </Descriptions>
                          </Card>
                        </Col>
                        <Col span={12}>
                          <Card size="small" title="本地版（驻地）" type="inner">
                            <Descriptions size="small" column={1} colon>
                              {diffKeys.map((key) => (
                                <Descriptions.Item key={key} label={fieldLabel(key)}>
                                  {displayValue(local[key])}
                                </Descriptions.Item>
                              ))}
                            </Descriptions>
                          </Card>
                        </Col>
                      </Row>
                    )
                  }
                }}
              />
            </Card>
          ) : null}

          <Card size="small" title="各表合并明细">
            <Table
              dataSource={merge.tables.map((table) => ({
                key: table.table,
                label: table.label,
                total: table.rows.length,
                field: table.rows.filter((row) => row.field).length,
                local: table.rows.filter((row) => row.local).length,
                conflicts: table.rows.filter((row) => row.status === 'conflict').length
              }))}
              rowKey="key"
              size="small"
              pagination={false}
              columns={[
                { title: '表', dataIndex: 'label', key: 'label' },
                { title: '总行数', dataIndex: 'total', key: 'total', width: 100 },
                { title: '外勤版', dataIndex: 'field', key: 'field', width: 100 },
                { title: '本地版', dataIndex: 'local', key: 'local', width: 100 },
                {
                  title: '冲突',
                  dataIndex: 'conflicts',
                  key: 'conflicts',
                  width: 100,
                  render: (value: number) => (value > 0 ? <Tag color="red">{value}</Tag> : <Tag>0</Tag>)
                }
              ]}
            />
          </Card>

          <Card size="small">
            <Space>
              <Button
                type="primary"
                icon={<CheckCircleOutlined />}
                loading={applying}
                onClick={() => void applyMerge()}
                disabled={merge.conflicts.some((row) => !resolutions[`${row.table}:${row.id}`])}
              >
                应用合并（写回本地）
              </Button>
              <Button
                onClick={() => {
                  setSnapshot(null)
                  setMerge(null)
                  setResolutions({})
                }}
              >
                取消
              </Button>
              <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                外勤新增 {merge.newFromField.length} 条将直接写入；本地新增 {merge.newAtLocal.length} 条保留；一致行不动；冲突按上方选择。
              </Typography.Text>
            </Space>
          </Card>
        </>
      ) : (
        <Card size="small">
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={
              <span>
                <MinusCircleOutlined /> 尚未导入离线包。导出离线包给外勤，或导入外勤带回的离线包开始合并。
              </span>
            }
          />
        </Card>
      )}
    </div>
  )
}
