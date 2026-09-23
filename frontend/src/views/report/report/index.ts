/**
 * 报表中心统一入口：
 * 时间口径 -> ./scope
 * 指标映射 / 空值处理 -> ./metrics
 * 数据事实 -> ./dataset
 * 聚合结果（唯一出口） -> ./engine
 * Excel 导出（消费同一结果） -> ./exporter
 */
export { resolveScope, REPORT_TYPE_OPTIONS } from './scope'
export { buildReport } from './engine'
export { exportReport, ExportError } from './exporter'
export * from './metrics'
export type {
  ReportResult,
  ReportScope,
  ReportType,
  RawRecord,
  MetricKey
} from './types'
