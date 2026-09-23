/**
 * 报表聚合引擎（唯一结果出口）
 *
 * 汇总卡、区块产量占比、产量趋势、明细表、Excel 导出
 * 全部消费同一个 buildReport 返回的 ReportResult，
 * 时间窗口（scope）、指标口径与空值处理（metrics）均不在各处重复实现。
 */
import { eachDay } from './scope'
import {
  fetchBaseline,
  fetchBlockRecords,
  fetchRecords,
  hasAnyData
} from './dataset'
import {
  deriveWaterCut,
  pctChange,
  round,
  sumOrNull,
  toBlockSlices
} from './metrics'
import type {
  BaselineSummary,
  BlockRecord,
  RawRecord,
  ReportResult,
  ReportScope,
  SummaryResult,
  TrendPoint
} from './types'

/** 趋势日期刻度（与原趋势图一致：M/D，不补零） */
function trendLabel(date: string): string {
  const [, m, d] = date.split('-').map(Number)
  return `${m}/${d}`
}

function sumOil(records: RawRecord[]): number | null {
  return sumOrNull(records.map((r) => r.oilProduction))
}
function sumWater(records: RawRecord[]): number | null {
  return sumOrNull(records.map((r) => r.waterProduction))
}
function sumBlockOil(records: BlockRecord[]): number | null {
  return sumOrNull(records.map((r) => r.oilProduction))
}

/**
 * 汇总指标统一聚合：
 * - 总产油 / 区块占比共用区块计量（保证卡片总量恒等于饼图之和）
 * - 总产水取自单井计量
 * - 平均含水率走 deriveWaterCut 唯一口径
 */
function aggregateSummary(
  wellRecords: RawRecord[],
  blockRecords: BlockRecord[]
): Omit<SummaryResult, 'oilDelta' | 'waterDelta' | 'waterCutDelta'> {
  const totalOil = round(sumBlockOil(blockRecords), 0)
  const totalWater = round(sumWater(wellRecords), 0)
  return {
    totalOil,
    totalWater,
    avgWaterCut: round(deriveWaterCut(totalOil, totalWater), 2)
  }
}

function buildTrend(records: RawRecord[], scope: ReportScope): TrendPoint[] {
  const byDate = new Map<string, RawRecord[]>()
  for (const record of records) {
    const list = byDate.get(record.date)
    if (list) list.push(record)
    else byDate.set(record.date, [record])
  }
  return eachDay(scope.trend).map((date) => {
    const dayRecords = byDate.get(date) ?? []
    return {
      date,
      label: trendLabel(date),
      oil: round(sumOil(dayRecords), 1),
      water: round(sumWater(dayRecords), 1)
    }
  })
}

function buildBlocks(blockRecords: BlockRecord[]) {
  const values = new Map<string, number>()
  for (const record of blockRecords) {
    const value = record.oilProduction
    if (value === null) continue
    values.set(record.block, (values.get(record.block) ?? 0) + value)
  }
  return toBlockSlices(values)
}

async function resolvePrevious(scope: ReportScope): Promise<BaselineSummary | null> {
  if (!scope.previous) return null
  const snapshot = await fetchBaseline(scope.previous)
  if (snapshot) return snapshot
  // 无后端快照时按同一口径实时聚合历史窗口
  const [wells, blocks] = await Promise.all([
    fetchRecords(scope.previous),
    fetchBlockRecords(scope.previous)
  ])
  const summary = aggregateSummary(wells, blocks)
  if (summary.totalOil === null && summary.totalWater === null) return null
  return {
    totalOil: summary.totalOil ?? 0,
    totalWater: summary.totalWater ?? 0,
    avgWaterCut: summary.avgWaterCut ?? 0
  }
}

/**
 * 生成一份报表的全部结果。
 * 调整报表类型或日期区间只需重新调用本函数，页面各区域与导出天然同源。
 */
export async function buildReport(scope: ReportScope): Promise<ReportResult> {
  const [wellRecords, blockRecords] = await Promise.all([
    fetchRecords(scope.aggregate),
    fetchBlockRecords(scope.aggregate)
  ])

  const empty = !hasAnyData(wellRecords, blockRecords)

  // 趋势 / 明细使用与汇总相同的数据事实，仅窗口不同（默认口径下由 scope 统一定义）
  const [trendRecords, detailRecords, previous] = await Promise.all([
    scope.trend.start === scope.aggregate.start && scope.trend.end === scope.aggregate.end
      ? Promise.resolve(wellRecords)
      : fetchRecords(scope.trend),
    scope.detail.start === scope.aggregate.start && scope.detail.end === scope.aggregate.end
      ? Promise.resolve(wellRecords)
      : fetchRecords(scope.detail),
    resolvePrevious(scope)
  ])

  const summaryBase = aggregateSummary(wellRecords, blockRecords)
  const blocks = buildBlocks(blockRecords)

  const summary: SummaryResult = {
    ...summaryBase,
    oilDelta: previous ? pctChange(summaryBase.totalOil, previous.totalOil) : null,
    waterDelta: previous ? pctChange(summaryBase.totalWater, previous.totalWater) : null,
    // 含水率环比为百分点差值，仍以 % 展示
    waterCutDelta:
      previous && summaryBase.avgWaterCut !== null
        ? round(summaryBase.avgWaterCut - previous.avgWaterCut, 1)
        : null
  }

  return {
    scope,
    empty,
    records: detailRecords,
    summary,
    trend: buildTrend(trendRecords, scope),
    blocks
  }
}
