import type { Dataset, FieldPack } from '@/utils/syncTypes'
import { isFieldPack } from '@/utils/syncTypes'
import { downloadJson } from '@/utils/export'

/** 驻地导出外勤数据包（基线与外勤初始内容相同，外勤在其本机离线修改） */
export function exportFieldPack(data: Dataset, exportedBy: string): void {
  const pack: FieldPack = {
    kind: 'gbbeeroute-field-pack',
    exportedAt: new Date().toISOString(),
    exportedBy: exportedBy.trim() || '驻地',
    ...data
  }
  downloadJson('外勤数据包-gbbeeroute.json', pack)
}

/** 外勤在其本机改完后导出回传包（结构与外勤包一致，导入驻地做三方合并） */
export function exportReturnPack(data: Dataset, exportedBy: string): void {
  exportFieldPack(data, exportedBy)
}

export interface ReadPackResult {
  ok: boolean
  pack?: FieldPack
  message: string
}

/** 读取并校验外勤 / 回传 JSON 文件 */
export function readPackFile(file: File): Promise<ReadPackResult> {
  return new Promise((resolve) => {
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const parsed: unknown = JSON.parse(String(reader.result))
        if (!isFieldPack(parsed)) {
          resolve({ ok: false, message: '文件不是本系统的外勤数据包（缺少标识或数据不全）' })
          return
        }
        resolve({ ok: true, pack: parsed, message: '外勤数据包读取成功' })
      } catch {
        resolve({ ok: false, message: 'JSON 解析失败，请确认文件完整' })
      }
    }
    reader.onerror = () => resolve({ ok: false, message: '文件读取失败' })
    reader.readAsText(file)
  })
}
