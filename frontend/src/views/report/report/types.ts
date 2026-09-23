/**
 * 报表中心共享类型定义
 *
 * 汇总卡片、产量趋势、区块产量、明细表与 Excel 导出
 * 全部基于同一份 ReportResult 渲染，任何一处口径调整只需改动
 * scope / metrics / engine 中的唯一来源。
 */

export type ReportType = 'daily' | 'weekly' | 'monthly' | 'drilling' | 'equipment' | 'hse'

export type WellStatus = '正常' | '异常'

/** 指标键（与指标映射表 metrics.ts 对应） */
export type MetricKey =
  | 'oilProduction'
  | 'waterProduction'
  | 'gasProduction'
  | 'waterCut'
  | 'workingHours'

/** 规范化后的井日生产记录（明细事实表一行） */
export interface RawRecord {
  /** 日期，统一 YYYY-MM-DD（本地口径，不含时区） */
  date: string
  wellName: string
  block: string
  oilProduction: number | null
  waterProduction: number | null
  gasProduction: number | null
  /** 含水率：优先使用现场填报值，缺失时由油/水量推导，见 metrics.deriveWaterCut */
  waterCut: number | null
  workingHours: number | null
  status: WellStatus
}

/** 区块日产量事实（区块计量独立于单井计量） */
export interface BlockRecord {
  date: string
  block: string
  oilProduction: number | null
}

/** 闭区间日期窗口，起止均为 YYYY-MM-DD */
export interface DateWindow {
  start: string
  end: string
}

/**
 * 一份报表涉及的全部时间窗口，由 scope.resolveScope 统一计算：
 * - aggregate 汇总卡 / 区块占比窗口
 * - detail    明细表窗口
 * - trend     趋势图窗口
 * - previous  上期对比窗口（无历史数据时为 null，趋势显示 --）
 */
export interface ReportScope {
  type: ReportType
  aggregate: DateWindow
  detail: DateWindow
  trend: DateWindow
  previous: DateWindow | null
  /** 用户选择的区间首尾接反，已自动交换后仍会标记出来用于提示 */
  reversed: boolean
  /** 是否为用户手工指定区间（自定义区间下四个窗口收拢为同一个） */
  custom: boolean
}

export interface SummaryResult {
  totalOil: number | null
  totalWater: number | null
  avgWaterCut: number | null
  /** 较上期变化百分比（含水率为百分点差值），无上期数据时为 null */
  oilDelta: number | null
  waterDelta: number | null
  waterCutDelta: number | null
}

export interface TrendPoint {
  date: string
  label: string
  oil: number | null
  water: number | null
}

export interface BlockSlice {
  name: string
  value: number
  color: string
}

export interface ReportResult {
  scope: ReportScope
  /** 汇总窗口内无任何数据 */
  empty: boolean
  /** 明细行（已按日期、井序排序，空值统一为 null） */
  records: RawRecord[]
  summary: SummaryResult
  trend: TrendPoint[]
  blocks: BlockSlice[]
}

/** 上期汇总快照（模拟后端对历史区间的聚合结果） */
export interface BaselineSummary {
  totalOil: number
  totalWater: number
  avgWaterCut: number
}
