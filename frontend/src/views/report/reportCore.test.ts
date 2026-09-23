/**
 * 报表中心口径回归检查（可在接入 vitest 前直接用 esbuild 打包后 node 执行）。
 * 覆盖：历史数值不变、无数据、区间接反、空值口径、导出与明细一致、导出失败。
 */
import assert from 'node:assert'
import { buildReport, exportReportCsv, normalizeRange, type ReportType } from './reportCore'

const JAN: [string, string] = ['2024-01-01', '2024-01-31']

// 1. 首屏生产日报历史口径逐项不变
const daily = buildReport('daily', JAN).result!
assert.equal(daily.cards[0].value, '12,586')
assert.equal(daily.cards[1].value, '35,241')
assert.equal(daily.cards[2].value, '73.68')
assert.equal(daily.cards[0].trendText, '较上期 +8.5%')
assert.equal(daily.cards[1].trendText, '较上期 -3.2%')
assert.deepEqual(
  daily.pie.map((s) => [s.name, s.value]),
  [['C区块', 4123], ['B区块', 3245], ['A区块', 2586], ['D区块', 1856], ['E区块', 776]]
)
const oilSeries = daily.trend.series[0].data.slice(9, 20)
assert.deepEqual(
  oilSeries,
  [520, 535, 560, 545, 578, 578.3, 580, 592, 605, 610, 625]
)
const anchorExpected: Record<string, (number | string)[]> = {
  'A-01井': [125.6, 352.1, 850, 73.7, 24, '正常'],
  'B-03井': [98.3, 285.6, 720, 74.4, 24, '正常'],
  'C-02井': [156.2, 412.3, 980, 72.5, 22, '正常'],
  'D-05井': [85.4, 268.9, 650, 75.9, 24, '异常'],
  'E-01井': [112.8, 325.4, 790, 74.2, 24, '正常']
}
for (const row of daily.table.filter((r) => r.exportDateLabel === '2024-01-15')) {
  assert.deepEqual(
    [
      row.values.oilProduction,
      row.values.waterProduction,
      row.values.gasProduction,
      row.values.waterCut,
      row.values.workingHours,
      row.status
    ],
    anchorExpected[row.name],
    `锚点日 ${row.name}`
  )
}

// 2. 汇总 / 区块 / 明细 / 导出同源：卡片总量 = 明细同列之和（跳过空值）
const tableOil = daily.table.reduce((s, r) => s + (r.values.oilProduction ?? 0), 0)
assert.equal(Math.round(tableOil), 12586)
const pieOil = daily.pie.reduce((s, x) => s + x.value, 0)
assert.equal(Math.round(pieOil), 12586)

// 3. 区间接反：自动对调，结果与正序逐字段一致
const reversed = buildReport('daily', ['2024-01-31', '2024-01-01'])
assert.equal(reversed.range!.swapped, true)
assert.equal(reversed.range!.start, '2024-01-01')
assert.deepEqual(reversed.result!.table, daily.table)
assert.deepEqual(reversed.result!.cards, daily.cards)
assert.equal(normalizeRange(['2024-01-31', '2024-01-01'])!.swapped, true)
assert.equal(normalizeRange(null), null)
assert.equal(normalizeRange(['', '']), null)

// 4. 无数据：卡片 / 图 / 表全部为空态且不报错
const empty = buildReport('daily', ['2025-03-01', '2025-03-10']).result!
assert.equal(empty.empty, true)
assert.ok(empty.cards.every((c) => c.value === '—'))
assert.equal(empty.pie.length, 0)
assert.equal(empty.table.length, 0)
assert.ok(empty.trend.series.every((s) => s.data.every((v) => v === null)))

// 5. 空值口径：缺失单元格统一 —，聚合跳过缺失
const gasNull = daily.table.find((r) => r.exportDateLabel === '2024-01-22' && r.name === 'B-03井')!
assert.equal(gasNull.values.gasProduction, null)
const stopped = daily.table.find((r) => r.exportDateLabel === '2024-01-28' && r.name === 'D-05井')!
assert.equal(stopped.status, '停机')
assert.ok(Object.values(stopped.values).every((v) => v === null))

// 6. 导出：列与明细完全一致，空值为 —，行数与表相同
const exported = exportReportCsv(daily)
const lines = exported.content.replace(/^﻿/, '').split('\r\n')
assert.equal(
  lines[0],
  '日期,井名,产油量(t),产水量(t),产气量(m³),含水率(%),生产时长(h),状态'
)
assert.equal(lines.length - 1, daily.table.length)
assert.equal(lines.find((l) => l.startsWith('2024-01-15,A-01井')), '2024-01-15,A-01井,125.6,352.1,850,73.7,24,正常')
assert.equal(lines.find((l) => l.startsWith('2024-01-22,B-03井')), '2024-01-22,B-03井,96.4,225.6,—,70.1,24,正常')
assert.ok(/^生产日报_2024-01-01_2024-01-31\.csv$/.test(exported.filename))

// 7. 导出失败：无数据区间直接抛出，由视图层提示
assert.throws(() => exportReportCsv(empty), /没有可导出的数据/)

// 8. 周 / 月口径与日口径总量一致（同一结果的不同分桶）
const round1 = (v: number) => Math.round(v * 10) / 10
const weekly = buildReport('weekly', JAN).result!
const monthly = buildReport('monthly', JAN).result!
assert.equal(weekly.cards[0].value, daily.cards[0].value)
assert.equal(monthly.cards[0].value, daily.cards[0].value)
assert.equal(round1(weekly.table.reduce((s, r) => s + (r.values.oilProduction ?? 0), 0)), round1(tableOil))
assert.equal(round1(monthly.table.reduce((s, r) => s + (r.values.oilProduction ?? 0), 0)), round1(tableOil))

// 9. 六类报表均可正常构建，且都走同一出口
for (const type of ['daily', 'weekly', 'monthly', 'drilling', 'equipment', 'hse'] as ReportType[]) {
  const r = buildReport(type, JAN).result!
  assert.ok(r.cards.length === 3)
  assert.ok(r.columns.length > 0)
  assert.ok(r.table.length > 0)
  const csv = exportReportCsv(r)
  assert.equal(csv.content.replace(/^﻿/, '').split('\r\n').length - 1, r.table.length)
}

console.log('reportCore 回归检查全部通过 ✔')
