/**
 * 规范化数据源（模拟后端事实表）
 *
 * 只产出两类事实：
 * - 井日生产记录 RawRecord（明细表、趋势、单井汇总的唯一来源）
 * - 区块日产量 BlockRecord（区块占比的唯一来源，区块计量独立于单井计量）
 *
 * 所有数值按现有报表锚定生成：
 * - 2024-01-15 当日五口井的明细与原静态明细表逐格一致
 * - 1/10~1/20 趋势逐日合计与原趋势图一致
 * - 1/1~1/20 区块合计与原饼图一致，油/水合计与原汇总卡一致
 * 历史接口接入后，用真实接口替换本文件即可，上层口径不受影响。
 */
import { addDays } from './scope'
import type {
  BaselineSummary,
  BlockRecord,
  DateWindow,
  RawRecord,
  WellStatus
} from './types'
import { deriveWaterCut, nullify, round } from './metrics'

const WELLS = [
  { wellName: 'A-01井', block: 'A区块' },
  { wellName: 'B-03井', block: 'B区块' },
  { wellName: 'C-02井', block: 'C区块' },
  { wellName: 'D-05井', block: 'D区块' },
  { wellName: 'E-01井', block: 'E区块' }
] as const

/** 1/15 五口井明细（与原静态明细表逐格一致，含水率采用现场填报值） */
const ANCHOR_DATE = '2024-01-15'
const ANCHOR_OIL = [125.6, 98.3, 156.2, 85.4, 112.8]
const ANCHOR_WATER = [352.1, 285.6, 412.3, 268.9, 325.4]
const ANCHOR_GAS = [850, 720, 980, 650, 790]
const ANCHOR_HOURS = [24, 24, 22, 24, 24]
const ANCHOR_CUT = [73.7, 74.4, 72.5, 75.9, 74.2]
const ANCHOR_STATUS: WellStatus[] = ['正常', '正常', '正常', '异常', '正常']

/** 1/10~1/20 趋势逐日油/水合计（与原趋势图逐点一致） */
const TREND_START = '2024-01-10'
const TREND_DAILY_OIL = [520, 535, 560, 545, 578, 578.3, 580, 592, 605, 610, 625]
const TREND_DAILY_WATER = [1640, 1680, 1650, 1700, 1720, 1644.3, 1680, 1710, 1730, 1750, 1780]

/** 1/1~1/20 区块累计油（与原饼图一致，区块独立计量） */
const BLOCK_TARGET: Record<string, number> = {
  A区块: 2586,
  B区块: 3245,
  C区块: 4123,
  D区块: 1856,
  E区块: 776
}

/** 1/1~1/20 全油田产水合计（与原汇总卡 35,241 一致） */
const MONTH_WATER_TOTAL = 35241

/**
 * 历史环比快照（默认日口径的上期 12/12~12/31、月口径的上期 2023-12）。
 * 数值锚定原汇总卡：油 +8.5%、水 -3.2%、含水率 +1.2 个百分点。
 */
const BASELINES: Record<string, BaselineSummary> = {
  '2023-12-12': { totalOil: 11600, totalWater: 36406, avgWaterCut: 72.48 },
  '2023-12-01': { totalOil: 11600, totalWater: 36406, avgWaterCut: 72.48 }
}

/** 按权重分配到各项，保留 1 位小数，舍入残差并入第一项 */
function allocate(total: number, weights: number[]): number[] {
  const weightSum = weights.reduce((acc, w) => acc + w, 0)
  const parts = weights.map((w) => round((total * w) / weightSum, 1) as number)
  const remainder = round(total - parts.reduce((acc, p) => acc + p, 0), 1) as number
  parts[0] = round(parts[0] + remainder, 1) as number
  return parts
}

/** 将总量按天均分（1 位小数），尾差并入最后一天 */
function spreadAcrossDays(total: number, days: number): number[] {
  const base = round(total / days, 1) as number
  const result = new Array(days).fill(base)
  const remainder = round(total - base * days, 1) as number
  result[days - 1] = round(base + remainder, 1) as number
  return result
}

function buildBlockRecords(): BlockRecord[] {
  const records: BlockRecord[] = []
  Object.entries(BLOCK_TARGET).forEach(([block, target]) => {
    const daily = spreadAcrossDays(target, 20)
    daily.forEach((value, index) => {
      records.push({ date: addDays('2024-01-01', index), block, oilProduction: value })
    })
  })
  return records
}

function buildWellRecords(): RawRecord[] {
  const records: RawRecord[] = []

  // 以 1/15 的油/水结构作为各井分配权重
  const oilWeights = [...ANCHOR_OIL]
  const waterWeights = [...ANCHOR_WATER]

  // 区块每日油（早于趋势窗的 1/1~1/9 单井数据直接取所在区块的独立计量）
  const blockDaily: Record<string, number[]> = {}
  Object.entries(BLOCK_TARGET).forEach(([block, target]) => {
    blockDaily[block] = spreadAcrossDays(target, 20)
  })

  // 趋势窗之前 1/1~1/9 的产水（月度总量减去趋势窗合计）
  const trendWaterTotal = TREND_DAILY_WATER.reduce((acc, v) => acc + v, 0)
  const earlyWaterDaily = spreadAcrossDays(MONTH_WATER_TOTAL - trendWaterTotal, 9)

  const pushDay = (
    date: string,
    oilDaily: number[],
    waterDaily: number[],
    gasOverride?: (index: number) => number | null
  ) => {
    WELLS.forEach((well, index) => {
      const oil = oilDaily[index]
      const water = waterDaily[index]
      const gas = gasOverride ? gasOverride(index) : ANCHOR_GAS[index]
      const isAnchor = date === ANCHOR_DATE
      records.push({
        date,
        wellName: well.wellName,
        block: well.block,
        oilProduction: oil,
        waterProduction: water,
        gasProduction: gas,
        // 锚点日使用现场填报含水率；其余日期走统一推导口径
        waterCut: isAnchor
          ? ANCHOR_CUT[index]
          : round(deriveWaterCut(oil, water), 1),
        workingHours: ANCHOR_HOURS[index],
        status: ANCHOR_STATUS[index]
      })
    })
  }

  // 1/1 ~ 1/9
  for (let i = 0; i < 9; i++) {
    const date = addDays('2024-01-01', i)
    const oilDaily = WELLS.map((w) => blockDaily[w.block][i])
    const waterDaily = allocate(earlyWaterDaily[i], waterWeights)
    pushDay(date, oilDaily, waterDaily)
  }

  // 1/10 ~ 1/20（趋势窗口）
  TREND_DAILY_OIL.forEach((dayOil, i) => {
    const date = addDays(TREND_START, i)
    const oilDaily =
      date === ANCHOR_DATE
        ? [...ANCHOR_OIL]
        : allocate(dayOil, oilWeights)
    const waterDaily =
      date === ANCHOR_DATE
        ? [...ANCHOR_WATER]
        : allocate(TREND_DAILY_WATER[i], waterWeights)
    pushDay(date, oilDaily, waterDaily, (index) =>
      date === '2024-01-12' && index === 2 ? null : ANCHOR_GAS[index]
    )
  })

  return records
}

const WELL_RECORDS = buildWellRecords()
const BLOCK_RECORDS = buildBlockRecords()

const inWindow = (date: string, window: DateWindow): boolean =>
  date >= window.start && date <= window.end

/** 拉取窗口内的井日生产记录（模拟异步接口；空区间返回空数组） */
export function fetchRecords(window: DateWindow): Promise<RawRecord[]> {
  const rows = WELL_RECORDS.filter((r) => inWindow(r.date, window)).map((r) => ({
    ...r,
    oilProduction: nullify(r.oilProduction),
    waterProduction: nullify(r.waterProduction),
    gasProduction: nullify(r.gasProduction),
    waterCut: nullify(r.waterCut),
    workingHours: nullify(r.workingHours)
  }))
  return Promise.resolve(rows)
}

/** 拉取窗口内的区块日产量 */
export function fetchBlockRecords(window: DateWindow): Promise<BlockRecord[]> {
  const rows = BLOCK_RECORDS.filter((r) => inWindow(r.date, window)).map((r) => ({
    ...r,
    oilProduction: nullify(r.oilProduction)
  }))
  return Promise.resolve(rows)
}

/** 历史区间的后端聚合快照；无快照返回 null，由引擎实时聚合 */
export function fetchBaseline(window: DateWindow): Promise<BaselineSummary | null> {
  return Promise.resolve(BASELINES[window.start] ?? null)
}

/** 数据集中是否存在任一记录（空数据区间判断） */
export function hasAnyData(
  wellRecords: RawRecord[],
  blockRecords: BlockRecord[]
): boolean {
  return wellRecords.length > 0 || blockRecords.length > 0
}
