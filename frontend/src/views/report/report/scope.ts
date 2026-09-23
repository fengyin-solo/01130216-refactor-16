/**
 * 时间口径唯一来源
 *
 * 所有报表（汇总卡、区块产量、产量趋势、明细表）以及 Excel 导出，
 * 涉及"取哪一段时间"的判断只能走 resolveScope，禁止在各处自行
 * new Date() / 手工拼日期。
 *
 * 约定：日期一律使用 YYYY-MM-DD 字符串（本地日历口径），
 * 所有窗口均为闭区间。
 */
import type { DateWindow, ReportScope, ReportType } from './types'

/** 报表类型选项（页面下拉与导出文件命名共用，保证"现有报表类型"只有一处定义） */
export const REPORT_TYPE_OPTIONS: { label: string; value: ReportType }[] = [
  { label: '生产日报', value: 'daily' },
  { label: '生产周报', value: 'weekly' },
  { label: '生产月报', value: 'monthly' },
  { label: '钻井进度报表', value: 'drilling' },
  { label: '设备运行报表', value: 'equipment' },
  { label: 'HSE报表', value: 'hse' }
]

/**
 * 数据锚定日期（模拟"今天"）。
 * 后端接入后可替换为服务端当天；历史数据范围由 dataset 统一裁剪。
 */
export const ANCHOR_DATE = '2024-01-20'
/** 指标明细基准日（日报默认取当日单井明细，与原静态报表一致） */
export const DETAIL_ANCHOR_DATE = '2024-01-15'
/** 趋势固定回看天数（含当天） */
export const TREND_DAYS = 11
/** 周报窗口天数（含起止） */
export const WEEK_DAYS = 7

/** 数据集最早日期，趋势窗口向前不能越界 */
export const DATASET_START = '2024-01-10'
/** 用于环比的历史数据起点（去年12月） */
export const HISTORY_START = '2023-12-01'

/** 补零格式化 */
function pad(n: number): string {
  return String(n).padStart(2, '0')
}

/** Date -> YYYY-MM-DD（本地时区） */
export function formatDate(date: Date): string {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** YYYY-MM-DD -> 本地 Date（避免 UTC 解析造成跨日偏移） */
export function parseDate(value: string): Date {
  const [y, m, d] = value.split('-').map(Number)
  return new Date(y, m - 1, d)
}

export function addDays(value: string, delta: number): string {
  const date = parseDate(value)
  date.setDate(date.getDate() + delta)
  return formatDate(date)
}

/** 闭区间内的全部日期（升序） */
export function eachDay(window: DateWindow): string[] {
  const days: string[] = []
  for (let cur = window.start; cur <= window.end; cur = addDays(cur, 1)) {
    days.push(cur)
  }
  return days
}

/** 区间天数（含起止，单天为 1） */
export function daySpan(window: DateWindow): number {
  const diff = parseDate(window.end).getTime() - parseDate(window.start).getTime()
  return Math.round(diff / 86_400_000) + 1
}

/** 等长紧邻的上一区间 */
export function previousWindow(window: DateWindow): DateWindow {
  const span = daySpan(window)
  return {
    end: addDays(window.start, -1),
    start: addDays(window.start, -span)
  }
}

/** 返回该日期所在自然周（周一为一周起点） */
function weekContaining(value: string): DateWindow {
  const date = parseDate(value)
  const offset = (date.getDay() + 6) % 7
  return { start: addDays(value, -offset), end: addDays(value, 6 - offset) }
}

/**
 * 未指定日期区间时，按报表类型取该类型的默认窗口。
 * 返回 aggregate/detail/trend/previous 四个窗口。
 */
function defaultScope(type: ReportType): Omit<ReportScope, 'reversed' | 'custom'> {
  const trendStart = addDays(ANCHOR_DATE, -(TREND_DAYS - 1))

  if (type === 'weekly') {
    const week = weekContaining(ANCHOR_DATE) // 2024-01-15(周一) ~ 2024-01-21(周日)
    return {
      type,
      aggregate: week,
      detail: { start: DETAIL_ANCHOR_DATE, end: week.end },
      trend: { start: trendStart, end: week.end },
      previous: previousWindow(week)
    }
  }

  if (type === 'monthly') {
    const anchor = parseDate(ANCHOR_DATE)
    const monthStart = `${anchor.getFullYear()}-${pad(anchor.getMonth() + 1)}-01`
    const month: DateWindow = { start: monthStart, end: ANCHOR_DATE }
    const prevYear = anchor.getFullYear() - 1
    const prevMonth = pad(anchor.getMonth() + 1)
    return {
      type,
      aggregate: month,
      detail: { start: monthStart, end: ANCHOR_DATE },
      trend: { start: trendStart, end: ANCHOR_DATE },
      previous: { start: `${prevYear}-${prevMonth}-01`, end: `${prevYear}-${prevMonth}-31` }
    }
  }

  // daily / drilling / equipment / hse：共用日粒度口径
  const monthStart = `2024-01-01`
  return {
    type,
    aggregate: { start: monthStart, end: ANCHOR_DATE },
    detail: { start: DETAIL_ANCHOR_DATE, end: DETAIL_ANCHOR_DATE },
    trend: { start: trendStart, end: ANCHOR_DATE },
    previous: previousWindow({ start: monthStart, end: ANCHOR_DATE })
  }
}

/**
 * 计算报表全部时间窗口。
 *
 * @param type     报表类型
 * @param range    用户在日期控件选择的 [开始, 结束]；为空时走类型默认口径
 * @returns 统一窗口集合。区间首尾接反时自动交换并标记 reversed，
 *          由调用方给出提示；自定义区间下汇总/明细/趋势收拢为同一区间。
 */
export function resolveScope(
  type: ReportType,
  range: [string, string] | null
): ReportScope {
  if (!range || !range[0] || !range[1]) {
    return { ...defaultScope(type), reversed: false, custom: false }
  }

  let [start, end] = range
  let reversed = false
  if (start > end) {
    ;[start, end] = [end, start]
    reversed = true
  }

  const window: DateWindow = { start, end }
  return {
    type,
    aggregate: window,
    detail: window,
    trend: window,
    previous: previousWindow(window),
    reversed,
    custom: true
  }
}
