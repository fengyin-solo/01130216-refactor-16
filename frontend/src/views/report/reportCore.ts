/**
 * 报表中心唯一口径层。
 *
 * 汇总卡片、区块占比、趋势图、明细表、Excel 导出全部由 buildReport() 的同一份结果驱动，
 * 任何报表类型都不允许在视图层另行计算或兜底。
 *
 * 三条统一规则：
 * 1. 时间口径：normalizeRange() 是区间的唯一入口（默认值、接反对调、边界判断都在这里）；
 * 2. 指标映射：METRIC 定义 + aggregate() 是指标的唯一计算方式（求和 / 均值 / 比率）；
 * 3. 空值口径：原始缺失统一为 null；聚合跳过缺失、全缺为 null；展示与导出统一显示「—」。
 */

import { getRawRows, type RawRow } from './reportMock'

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'drilling' | 'equipment' | 'hse'
export type AggType = 'sum' | 'avg' | 'ratio'

export interface MetricDef {
  key: string
  label: string
  /** 聚合方式：sum 求和；avg 均值（跳过空值）；ratio 加权比率，结果为百分数 */
  agg: AggType
  decimals: number
  /** ratio：分子字段 */
  numKey?: string
  /** ratio：分母字段（单字段或多字段之和） */
  denKeys?: string[]
}

export interface SummaryCardDef {
  metricKey: string
  label: string
  unit: string
  decimals: number
  /** thousands：千分位整数样式（如 12,586）；plain：普通数值 */
  style: 'thousands' | 'plain'
  /** percent：环比按相对变化率；delta：直接按指标差值（同单位） */
  trend: 'percent' | 'delta'
  /** delta 环比文案的单位后缀（含水率、整改率是百分点；钻速是 m/h） */
  deltaUnit?: string
}

export interface ReportConfig {
  label: string
  /** 明细行识别字段：用该字段是否存在区分六类报表的原始行 */
  rowMarker: string
  groupLabel: string
  dateLabel: string
  nameLabel: string
  metrics: MetricDef[]
  summaries: SummaryCardDef[]
  /** 明细表列（顺序即导出列顺序） */
  tableKeys: string[]
  /** 趋势图两条曲线使用的指标（第二条允许是比率指标） */
  trendKeys: [string, string]
  trendTitle: string
  trendSeriesNames: [string, string]
  /** 区块 / 分组占比图 */
  pieMetricKey: string
  pieTitle: string
  pieName: string
  /** 占比图数值单位（拼在 {c} 后） */
  pieUnit: string
  /** 趋势两条曲线是否堆叠（仅生产类产油/产水沿用旧堆叠样式） */
  stackTrend: boolean
  /** 生产类报表才有状态列 */
  hasStatus: boolean
}

// ---------------------------------------------------------------------------
// 指标映射（六类报表共用同一份定义，视图与导出只认这里的 label / decimals / agg）
// ---------------------------------------------------------------------------

const PRODUCTION_METRICS: MetricDef[] = [
  { key: 'oilProduction', label: '产油量(t)', agg: 'sum', decimals: 1 },
  { key: 'waterProduction', label: '产水量(t)', agg: 'sum', decimals: 1 },
  { key: 'gasProduction', label: '产气量(m³)', agg: 'sum', decimals: 0 },
  {
    key: 'waterCut',
    label: '含水率(%)',
    agg: 'ratio',
    decimals: 1,
    numKey: 'waterProduction',
    denKeys: ['oilProduction', 'waterProduction']
  },
  { key: 'workingHours', label: '生产时长(h)', agg: 'sum', decimals: 0 }
]

const DRILLING_METRICS: MetricDef[] = [
  { key: 'footage', label: '进尺(m)', agg: 'sum', decimals: 1 },
  {
    key: 'rop',
    label: '机械钻速(m/h)',
    agg: 'ratio',
    decimals: 1,
    numKey: 'footage',
    denKeys: ['drillingHours']
  },
  { key: 'drillingHours', label: '钻井时长(h)', agg: 'sum', decimals: 0 }
]

const EQUIPMENT_METRICS: MetricDef[] = [
  { key: 'runHours', label: '运行时长(h)', agg: 'sum', decimals: 1 },
  { key: 'faultCount', label: '故障次数', agg: 'sum', decimals: 0 },
  { key: 'utilization', label: '利用率(%)', agg: 'avg', decimals: 1 }
]

const HSE_METRICS: MetricDef[] = [
  { key: 'hazards', label: '隐患数', agg: 'sum', decimals: 0 },
  { key: 'rectified', label: '已整改数', agg: 'sum', decimals: 0 },
  {
    key: 'rectifyRate',
    label: '整改率(%)',
    agg: 'ratio',
    decimals: 1,
    numKey: 'rectified',
    denKeys: ['hazards']
  },
  { key: 'trainingHours', label: '培训时长(h)', agg: 'sum', decimals: 0 }
]

export const REPORT_CONFIGS: Record<ReportType, ReportConfig> = {
  daily: {
    label: '生产日报',
    rowMarker: 'status',
    groupLabel: '区块',
    dateLabel: '日期',
    nameLabel: '井名',
    metrics: PRODUCTION_METRICS,
    summaries: [
      { metricKey: 'oilProduction', label: '总产油量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterProduction', label: '总产水量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterCut', label: '平均含水率', unit: '%', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: '%' }
    ],
    tableKeys: ['oilProduction', 'waterProduction', 'gasProduction', 'waterCut', 'workingHours'],
    trendKeys: ['oilProduction', 'waterProduction'],
    trendTitle: '产量趋势分析',
    trendSeriesNames: ['产油量', '产水量'],
    pieMetricKey: 'oilProduction',
    pieTitle: '区块产量占比',
    pieName: '区块产量',
    pieUnit: 't',
    stackTrend: true,
    hasStatus: true
  },
  weekly: {
    label: '生产周报',
    rowMarker: 'status',
    groupLabel: '区块',
    dateLabel: '周次',
    nameLabel: '井名',
    metrics: PRODUCTION_METRICS,
    summaries: [
      { metricKey: 'oilProduction', label: '总产油量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterProduction', label: '总产水量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterCut', label: '平均含水率', unit: '%', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: '%' }
    ],
    tableKeys: ['oilProduction', 'waterProduction', 'gasProduction', 'waterCut', 'workingHours'],
    trendKeys: ['oilProduction', 'waterProduction'],
    trendTitle: '产量趋势分析',
    trendSeriesNames: ['产油量', '产水量'],
    pieMetricKey: 'oilProduction',
    pieTitle: '区块产量占比',
    pieName: '区块产量',
    pieUnit: 't',
    stackTrend: true,
    hasStatus: true
  },
  monthly: {
    label: '生产月报',
    rowMarker: 'status',
    groupLabel: '区块',
    dateLabel: '月份',
    nameLabel: '井名',
    metrics: PRODUCTION_METRICS,
    summaries: [
      { metricKey: 'oilProduction', label: '总产油量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterProduction', label: '总产水量', unit: '吨', decimals: 0, style: 'thousands', trend: 'percent' },
      { metricKey: 'waterCut', label: '平均含水率', unit: '%', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: '%' }
    ],
    tableKeys: ['oilProduction', 'waterProduction', 'gasProduction', 'waterCut', 'workingHours'],
    trendKeys: ['oilProduction', 'waterProduction'],
    trendTitle: '产量趋势分析',
    trendSeriesNames: ['产油量', '产水量'],
    pieMetricKey: 'oilProduction',
    pieTitle: '区块产量占比',
    pieName: '区块产量',
    pieUnit: 't',
    stackTrend: true,
    hasStatus: true
  },
  drilling: {
    label: '钻井进度报表',
    rowMarker: 'footage',
    groupLabel: '钻井队',
    dateLabel: '日期',
    nameLabel: '井名',
    metrics: DRILLING_METRICS,
    summaries: [
      { metricKey: 'footage', label: '总进尺', unit: 'm', decimals: 1, style: 'plain', trend: 'percent' },
      { metricKey: 'drillingHours', label: '总钻井时长', unit: 'h', decimals: 0, style: 'plain', trend: 'percent' },
      { metricKey: 'rop', label: '平均机械钻速', unit: 'm/h', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: 'm/h' }
    ],
    tableKeys: ['footage', 'rop', 'drillingHours'],
    trendKeys: ['footage', 'rop'],
    trendTitle: '钻井进度趋势',
    trendSeriesNames: ['进尺', '机械钻速'],
    pieMetricKey: 'footage',
    pieTitle: '各队进尺占比',
    pieName: '钻井进尺',
    pieUnit: 'm',
    stackTrend: false,
    hasStatus: false
  },
  equipment: {
    label: '设备运行报表',
    rowMarker: 'runHours',
    groupLabel: '设备类别',
    dateLabel: '日期',
    nameLabel: '设备名称',
    metrics: EQUIPMENT_METRICS,
    summaries: [
      { metricKey: 'runHours', label: '总运行时长', unit: 'h', decimals: 1, style: 'plain', trend: 'percent' },
      { metricKey: 'faultCount', label: '故障次数', unit: '次', decimals: 0, style: 'plain', trend: 'percent' },
      { metricKey: 'utilization', label: '平均利用率', unit: '%', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: '%' }
    ],
    tableKeys: ['runHours', 'faultCount', 'utilization'],
    trendKeys: ['runHours', 'faultCount'],
    trendTitle: '设备运行趋势',
    trendSeriesNames: ['运行时长', '故障次数'],
    pieMetricKey: 'runHours',
    pieTitle: '设备运行时长占比',
    pieName: '运行时长',
    pieUnit: 'h',
    stackTrend: false,
    hasStatus: false
  },
  hse: {
    label: 'HSE报表',
    rowMarker: 'hazards',
    groupLabel: '区块',
    dateLabel: '日期',
    nameLabel: '井名',
    metrics: HSE_METRICS,
    summaries: [
      { metricKey: 'hazards', label: '隐患总数', unit: '项', decimals: 0, style: 'plain', trend: 'percent' },
      { metricKey: 'rectified', label: '已整改数', unit: '项', decimals: 0, style: 'plain', trend: 'percent' },
      { metricKey: 'rectifyRate', label: '整改率', unit: '%', decimals: 2, style: 'plain', trend: 'delta', deltaUnit: '%' }
    ],
    tableKeys: ['hazards', 'rectified', 'rectifyRate', 'trainingHours'],
    trendKeys: ['hazards', 'rectified'],
    trendTitle: '隐患排查趋势',
    trendSeriesNames: ['隐患数', '已整改数'],
    pieMetricKey: 'hazards',
    pieTitle: '区块隐患占比',
    pieName: '隐患数',
    pieUnit: '项',
    stackTrend: false,
    hasStatus: false
  }
}

// ---------------------------------------------------------------------------
// 时间口径
// ---------------------------------------------------------------------------

export interface NormalizedRange {
  start: string
  end: string
  /** 用户把开始/结束选反时自动对调（视图层据此给一次提示） */
  swapped: boolean
}

const DAY_MS = 24 * 60 * 60 * 1000

export function toDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

function parseDate(s: string): Date {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}

function addDays(s: string, delta: number): string {
  return toDateStr(new Date(parseDate(s).getTime() + delta * DAY_MS))
}

export function diffDays(start: string, end: string): number {
  return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS)
}

/** 各报表类型的默认查询区间（与既有首屏数据保持一致：生产类默认 2024-01 全月） */
export function defaultRange(type: ReportType): [string, string] {
  void type
  return ['2024-01-01', '2024-01-31']
}

/**
 * 区间唯一入口：空数组视为未选择；开始晚于结束时静默对调并标记 swapped。
 * 不做数据边界裁剪 —— 选到数据范围之外时由「无数据」空态承接。
 */
export function normalizeRange(input: [string, string] | null | undefined): NormalizedRange | null {
  if (!input || !input[0] || !input[1]) return null
  const [a, b] = input
  if (a <= b) return { start: a, end: b, swapped: false }
  return { start: b, end: a, swapped: true }
}

/** 上一等长周期（紧接当前区间之前，长度相同），环比唯一口径 */
export function previousRange(range: NormalizedRange): NormalizedRange {
  const length = diffDays(range.start, range.end)
  const prevEnd = addDays(range.start, -1)
  return { start: addDays(prevEnd, -length), end: prevEnd, swapped: false }
}

/** 周期分桶 key + 展示标签 + 导出标签（日 / 周（周一为首日）/ 月） */
export function periodOf(type: ReportType, date: string): { key: string; label: string; exportLabel: string } {
  if (type === 'monthly') {
    return { key: date.slice(0, 7), label: date.slice(0, 7), exportLabel: date.slice(0, 7) }
  }
  if (type === 'weekly') {
    const d = parseDate(date)
    const dow = (d.getDay() + 6) % 7 // 周一=0
    const monday = new Date(d.getTime() - dow * DAY_MS)
    const sunday = new Date(monday.getTime() + 6 * DAY_MS)
    const key = toDateStr(monday)
    const md = (x: Date) => `${String(x.getMonth() + 1).padStart(2, '0')}/${String(x.getDate()).padStart(2, '0')}`
    return { key, label: `${md(monday)}~${md(sunday)}`, exportLabel: `${toDateStr(monday)}~${toDateStr(sunday)}` }
  }
  return { key: date, label: `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`, exportLabel: date }
}

function eachDay(range: NormalizedRange): string[] {
  const total = diffDays(range.start, range.end)
  return Array.from({ length: total + 1 }, (_, i) => addDays(range.start, i))
}

// ---------------------------------------------------------------------------
// 指标计算
// ---------------------------------------------------------------------------

const roundBy = (v: number, decimals: number) => {
  const f = 10 ** decimals
  return Math.round(v * f) / f
}

function sumField(rows: RawRow[], key: string): number {
  let total = 0
  for (const r of rows) {
    const v = r[key]
    if (typeof v === 'number') total += v
  }
  return total
}

/** 指标唯一计算入口：空值一律跳过；参与值全缺或分母为 0 时结果为 null */
export function aggregate(rows: RawRow[], metric: MetricDef, decimalsOverride?: number): number | null {
  const decimals = decimalsOverride ?? metric.decimals
  if (rows.length === 0) return null

  if (metric.agg === 'ratio') {
    const numerator = sumField(rows, metric.numKey as string)
    const denominator = (metric.denKeys as string[]).reduce((s, k) => s + sumField(rows, k), 0)
    if (denominator === 0) return null
    return roundBy((numerator / denominator) * 100, decimals)
  }

  const values: number[] = []
  for (const r of rows) {
    const v = r[metric.key]
    if (typeof v === 'number') values.push(v)
  }
  if (values.length === 0) return null

  if (metric.agg === 'sum') return roundBy(values.reduce((a, b) => a + b, 0), decimals)
  return roundBy(values.reduce((a, b) => a + b, 0) / values.length, decimals)
}

/** 生产类状态聚合：停机 > 异常 > 正常（明细合并行唯一口径） */
function mergeStatus(rows: RawRow[]): string {
  const statuses = rows.map((r) => String(r.status ?? '正常'))
  if (statuses.includes('停机')) return '停机'
  if (statuses.includes('异常')) return '异常'
  return '正常'
}

// ---------------------------------------------------------------------------
// 统一报表结果
// ---------------------------------------------------------------------------

export interface SummaryCard {
  label: string
  unit: string
  value: string
  trendText: string
  trendUp: boolean | null
}

export interface TableRow {
  dateLabel: string
  exportDateLabel: string
  name: string
  group: string
  values: Record<string, number | null>
  status?: string
}

export interface PieSlice {
  name: string
  value: number
}

export interface ReportResult {
  type: ReportType
  config: ReportConfig
  range: NormalizedRange
  empty: boolean
  cards: SummaryCard[]
  trend: { labels: string[]; series: { name: string; data: (number | null)[] }[] }
  pie: PieSlice[]
  table: TableRow[]
  /** 明细列定义（含 key/label，导出与表格共用） */
  columns: { key: string; label: string }[]
}

function metricMap(config: ReportConfig): Map<string, MetricDef> {
  return new Map(config.metrics.map((m) => [m.key, m]))
}

function formatCardValue(value: number | null, card: SummaryCardDef): string {
  if (value === null) return '—'
  if (card.style === 'thousands') {
    return roundBy(value, card.decimals).toLocaleString('en-US', {
      minimumFractionDigits: card.decimals,
      maximumFractionDigits: card.decimals
    })
  }
  return String(roundBy(value, card.decimals))
}

/** 明细单元格 / 导出单元格唯一格式化入口 */
export function formatCell(value: number | null, metric: MetricDef): string {
  if (value === null) return '—'
  return String(roundBy(value, metric.decimals))
}

function buildTrend(rows: RawRow[], type: ReportType, config: ReportConfig, range: NormalizedRange) {
  const map = metricMap(config)
  const buckets = new Map<string, { label: string; rows: RawRow[] }>()
  for (const date of eachDay(range)) {
    const p = periodOf(type, date)
    if (!buckets.has(p.key)) buckets.set(p.key, { label: p.label, rows: [] })
  }
  for (const r of rows) {
    const p = periodOf(type, r.date)
    const bucket = buckets.get(p.key)
    if (bucket) bucket.rows.push(r)
  }

  const labels = [...buckets.values()].map((b) => b.label)
  const series = config.trendKeys.map((key, i) => ({
    name: config.trendSeriesNames[i],
    data: [...buckets.values()].map((b) => aggregate(b.rows, map.get(key) as MetricDef))
  }))
  return { labels, series }
}

function buildTable(
  rows: RawRow[],
  type: ReportType,
  config: ReportConfig,
  nameOrder: string[]
): TableRow[] {
  const groups = new Map<string, {
    periodKey: string
    label: string
    exportLabel: string
    name: string
    group: string
    rows: RawRow[]
  }>()

  for (const r of rows) {
    const p = periodOf(type, r.date)
    const key = `${p.key}|${r.name}`
    let group = groups.get(key)
    if (!group) {
      group = {
        periodKey: p.key,
        label: p.label,
        exportLabel: p.exportLabel,
        name: r.name,
        group: r.group,
        rows: []
      }
      groups.set(key, group)
    }
    group.rows.push(r)
  }

  return [...groups.values()]
    .map((g) => {
      const values: Record<string, number | null> = {}
      for (const m of config.metrics) values[m.key] = aggregate(g.rows, m)
      const row: TableRow = {
        dateLabel: g.label,
        exportDateLabel: g.exportLabel,
        name: g.name,
        group: g.group,
        values
      }
      if (config.hasStatus) row.status = mergeStatus(g.rows)
      return row
    })
    .sort((a, b) => {
      // 用周首日 / 月份原始 key 排序，避免「1/10 排在 1/2 前」之类的标签字典序问题
      if (a.exportDateLabel !== b.exportDateLabel) {
        return a.exportDateLabel < b.exportDateLabel ? -1 : 1
      }
      return nameOrder.indexOf(a.name) - nameOrder.indexOf(b.name)
    })
}

/**
 * 报表唯一构建入口：时间区间 + 报表类型 → 一份同时供
 * 汇总卡片 / 趋势 / 占比 / 明细表 / 导出使用的结果。
 */
export function buildReport(
  type: ReportType,
  rawRange: [string, string] | null | undefined
): { result: ReportResult | null; range: NormalizedRange | null } {
  const config = REPORT_CONFIGS[type]
  const range = normalizeRange(rawRange)
  if (!range) return { result: null, range: null }

  const allRows = getRawRows()
  const scoped = allRows.filter((r) => r[config.rowMarker] !== undefined)
  const nameOrder = [...new Set(scoped.map((r) => r.name))]

  const inRange = scoped.filter((r) => r.date >= range.start && r.date <= range.end)
  const prevInRange = (() => {
    const prev = previousRange(range)
    return scoped.filter((r) => r.date >= prev.start && r.date <= prev.end)
  })()

  const map = metricMap(config)

  const cards: SummaryCard[] = config.summaries.map((card) => {
    const metric = map.get(card.metricKey) as MetricDef
    const value = aggregate(inRange, metric, card.decimals)
    // 环比用高精度值计算，避免两个已四舍五入的展示值相减产生二次误差
    const rawValue = aggregate(inRange, metric, 6)
    const rawPrev = aggregate(prevInRange, metric, 6)

    let trendText = '较上期 —'
    let trendUp: boolean | null = null
    if (rawValue !== null && rawPrev !== null && rawPrev !== 0) {
      if (card.trend === 'percent') {
        const pct = roundBy(((rawValue - rawPrev) / rawPrev) * 100, 1)
        trendText = `较上期 ${pct > 0 ? '+' : ''}${pct}%`
        trendUp = pct >= 0
      } else {
        const delta = roundBy(rawValue - rawPrev, 1)
        trendText = `较上期 ${delta > 0 ? '+' : ''}${delta}${card.deltaUnit ?? ''}`
        trendUp = delta >= 0
      }
    }
    return { label: card.label, unit: card.unit, value: formatCardValue(value, card), trendText, trendUp }
  })

  const pie: PieSlice[] = []
  {
    const pieMetric = map.get(config.pieMetricKey) as MetricDef
    const groupNames = [...new Set(inRange.map((r) => r.group))]
    for (const group of groupNames) {
      const v = aggregate(inRange.filter((r) => r.group === group), pieMetric)
      if (v !== null) pie.push({ name: group, value: v })
    }
    pie.sort((a, b) => b.value - a.value)
  }

  const trend = buildTrend(inRange, type, config, range)
  const table = buildTable(inRange, type, config, nameOrder)
  const columns = config.tableKeys.map((key) => ({
    key,
    label: (map.get(key) as MetricDef).label
  }))

  return {
    result: {
      type,
      config,
      range,
      empty: inRange.length === 0,
      cards,
      trend,
      pie,
      table,
      columns
    },
    range
  }
}

// ---------------------------------------------------------------------------
// 导出：与明细表共用同一结果（同列、同空值、同小数位），视图层无法另造口径
// ---------------------------------------------------------------------------

/** 由统一报表结果生成 CSV（带 BOM，Excel 直接可开） */
export function exportReportCsv(result: ReportResult): { filename: string; content: string } {
  if (result.empty || result.table.length === 0) {
    throw new Error('当前区间没有可导出的数据')
  }

  const config = result.config
  const map = metricMap(config)
  const header = [config.dateLabel, config.nameLabel, ...result.columns.map((c) => c.label)]
  if (config.hasStatus) header.push('状态')

  const escape = (cell: string) => (/[",\n]/.test(cell) ? `"${cell.replace(/"/g, '""')}"` : cell)
  const lines = [header.map(escape).join(',')]

  for (const row of result.table) {
    const cells = [row.exportDateLabel, row.name]
    for (const col of result.columns) {
      const v = row.values[col.key]
      cells.push(formatCell(v === undefined ? null : v, map.get(col.key) as MetricDef))
    }
    if (config.hasStatus) cells.push(row.status ?? '—')
    lines.push(cells.map(escape).join(','))
  }

  const filename = `${config.label}_${result.range.start}_${result.range.end}.csv`
  return { filename, content: '﻿' + lines.join('\r\n') }
}