/**
 * 指标映射、空值处理与数值口径唯一来源
 *
 * 汇总卡、趋势图、区块占比、明细表与 Excel 导出使用同一份
 * 字段映射（label/unit）、同一套空值（null -> '--'）与取整规则，
 * 杜绝各处各写一份后只改一处导致数值不一致。
 */
import type { BlockSlice, MetricKey, RawRecord } from './types'

/** 指标元数据：字段名 -> 表头 / 单位 / 小数位（页面与导出共用） */
export interface MetricMeta {
  key: MetricKey
  label: string
  unit: string
  /** 展示与导出统一保留的小数位 */
  precision: number
}

export const METRIC_META: Record<MetricKey, MetricMeta> = {
  oilProduction: { key: 'oilProduction', label: '产油量', unit: 't', precision: 1 },
  waterProduction: { key: 'waterProduction', label: '产水量', unit: 't', precision: 1 },
  gasProduction: { key: 'gasProduction', label: '产气量', unit: 'm³', precision: 0 },
  waterCut: { key: 'waterCut', label: '含水率', unit: '%', precision: 1 },
  workingHours: { key: 'workingHours', label: '生产时长', unit: 'h', precision: 0 }
}

/** 明细表 / 导出列顺序（一份定义两处使用） */
export const DETAIL_COLUMNS: { prop: keyof RawRecord; label: string; width?: number }[] = [
  { prop: 'date', label: '日期', width: 120 },
  { prop: 'wellName', label: '井名', width: 100 },
  { prop: 'oilProduction', label: '产油量(t)', width: 120 },
  { prop: 'waterProduction', label: '产水量(t)', width: 120 },
  { prop: 'gasProduction', label: '产气量(m³)', width: 120 },
  { prop: 'waterCut', label: '含水率(%)', width: 120 },
  { prop: 'workingHours', label: '生产时长(h)', width: 120 },
  { prop: 'status', label: '状态', width: 100 }
]

/** 区块配色唯一来源（饼图与导出表头一致取此处的名称） */
export const BLOCK_STYLES: { name: string; color: string }[] = [
  { name: 'A区块', color: '#3b82f6' },
  { name: 'B区块', color: '#22c55e' },
  { name: 'C区块', color: '#f59e0b' },
  { name: 'D区块', color: '#8b5cf6' },
  { name: 'E区块', color: '#ef4444' }
]

/** 统一的空值展示（所有图表、表格、导出遇到 null 一律显示它） */
export const EMPTY_TEXT = '--'

/** 安全转数字：undefined / null / NaN 归一为 null */
export function nullify(value: number | null | undefined): number | null {
  if (value === null || value === undefined || Number.isNaN(value)) return null
  return value
}

/** 四舍五入到指定小数位（null 透传） */
export function round(value: number | null, precision = 0): number | null {
  const v = nullify(value)
  if (v === null) return null
  const factor = 10 ** precision
  return Math.round(v * factor) / factor
}

/** 千分位 + 固定小数位；null 显示 -- */
export function formatNumber(value: number | null, precision = 0): string {
  const v = round(value, precision)
  if (v === null) return EMPTY_TEXT
  return v.toLocaleString('en-US', {
    minimumFractionDigits: precision,
    maximumFractionDigits: precision
  })
}

/** 按指标元数据格式化明细单元格（导出与页面共用） */
export function formatMetric(record: RawRecord, key: MetricKey): string {
  return formatNumber(record[key], METRIC_META[key].precision)
}

/**
 * 趋势点数值：整数不带小数，非整数保留一位小数。
 * 与原静态趋势图一致（520 而非 520.0，578.3 保留一位）。
 */
export function formatTrendValue(value: number | null): string | number {
  const v = round(value, 1)
  if (v === null) return EMPTY_TEXT
  return v
}

/**
 * 环比变化：返回带符号百分比文本（含水率同样显示百分号，保持原口径）。
 * 当期或上期缺失时返回 null，由调用方展示 EMPTY_TEXT。
 */
export function pctChange(current: number | null, previous: number | null): number | null {
  const cur = nullify(current)
  const prev = nullify(previous)
  if (cur === null || prev === null || prev === 0) return null
  return round(((cur - prev) / prev) * 100, 1)
}

/** 环比文案：+8.5% / -3.2% / --（含水率为百分点差值但沿用 % 展示） */
export function formatDelta(delta: number | null, suffix = '%'): string {
  const v = nullify(delta)
  if (v === null) return EMPTY_TEXT
  const sign = v > 0 ? '+' : ''
  return `${sign}${v}${suffix}`
}

/** 非空数值求和；全部为空时返回 null（空值不参与计算也不当作 0） */
export function sumOrNull(values: (number | null)[]): number | null {
  let total = 0
  let hasValue = false
  for (const value of values) {
    const v = nullify(value)
    if (v === null) continue
    total += v
    hasValue = true
  }
  return hasValue ? total : null
}

/**
 * 含水率唯一推导口径：水 / (油 + 水) × 100。
 * 任一侧缺失或分母为 0 时返回 null，交由空值处理统一展示。
 */
export function deriveWaterCut(
  oil: number | null,
  water: number | null
): number | null {
  const o = nullify(oil)
  const w = nullify(water)
  if (o === null || w === null || o + w === 0) return null
  return (w / (o + w)) * 100
}

/** 区块结果统一造型（名称与配色取自 BLOCK_STYLES 同一份映射） */
export function toBlockSlices(values: Map<string, number>): BlockSlice[] {
  return BLOCK_STYLES.map(({ name, color }) => ({
    name,
    color,
    value: round(values.get(name) ?? 0, 0) ?? 0
  })).filter((slice) => slice.value > 0)
}
