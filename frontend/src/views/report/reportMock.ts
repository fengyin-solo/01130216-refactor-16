/**
 * 报表中心统一数据源（前端原型期使用确定性内存数据，后续替换为接口时仅改本文件）。
 *
 * 关键约定（全报表唯一口径，禁止在别处另行兜底）：
 * - 每一行是「某对象 在 某一天」的采集记录，所有汇总 / 区块 / 明细 / 导出均由这批行聚合而来；
 * - 缺失采集值统一用 null 表示，聚合与展示按 reportCore 中的空值规则处理。
 */

export interface RawRow {
  date: string // YYYY-MM-DD
  name: string // 井名 / 设备名
  group: string // 区块 / 机组等分组维度
  [metric: string]: string | number | null
}

/** 数据覆盖的时间边界，默认时间区间以此为准 */
export const DATA_BOUNDS = {
  start: '2023-12-01',
  end: '2024-01-31'
}

const PROD_WELLS = [
  { name: 'A-01井', group: 'A区块' },
  { name: 'B-03井', group: 'B区块' },
  { name: 'C-02井', group: 'C区块' },
  { name: 'D-05井', group: 'D区块' },
  { name: 'E-01井', group: 'E区块' }
]

/** 2024-01-15 五口井的采集值（历史明细，必须原样保留） */
const ANCHOR_DAY = '2024-01-15'
const ANCHOR_ROWS: Record<string, { oil: number; water: number; gas: number; hours: number; cut: number; status: string }> = {
  'A-01井': { oil: 125.6, water: 352.1, gas: 850, hours: 24, cut: 73.7, status: '正常' },
  'B-03井': { oil: 98.3, water: 285.6, gas: 720, hours: 24, cut: 74.4, status: '正常' },
  'C-02井': { oil: 156.2, water: 412.3, gas: 980, hours: 22, cut: 72.5, status: '正常' },
  'D-05井': { oil: 85.4, water: 268.9, gas: 650, hours: 24, cut: 75.9, status: '异常' },
  // 历史记录的含水率 74.2 与一位小数采集值 112.8 / 325.4 直接相除（74.3）存在采集舍入差，
  // 内部保留一位额外精度，使三项展示值（112.8、325.4、74.2）与历史明细完全一致。
  'E-01井': { oil: 112.84, water: 325.36, gas: 790, hours: 24, cut: 74.2, status: '正常' }
}

/** 2024-01-10 ~ 2024-01-20 的日产油 / 日产水总量（历史趋势，必须原样保留） */
const WINDOW_DAY_TOTALS: Record<string, { oil: number; water: number }> = {
  '2024-01-10': { oil: 520, water: 1640 },
  '2024-01-11': { oil: 535, water: 1680 },
  '2024-01-12': { oil: 560, water: 1650 },
  '2024-01-13': { oil: 545, water: 1700 },
  '2024-01-14': { oil: 578, water: 1720 },
  '2024-01-15': { oil: 578.3, water: 1644.3 },
  '2024-01-16': { oil: 580, water: 1680 },
  '2024-01-17': { oil: 592, water: 1710 },
  '2024-01-18': { oil: 605, water: 1730 },
  '2024-01-19': { oil: 610, water: 1750 },
  '2024-01-20': { oil: 625, water: 1780 }
}

/**
 * 1 月分区块月度目标：
 * 油 2586+3245+4123+1856+776 = 12586；水合计 35241（对应综合含水率 73.68%）。
 * 12 月作为「上一等长周期」：油 11600（+8.5%）、水 36406（-3.2%）。
 */
const BLOCK_MONTH_TARGETS: Record<string, Record<string, { oil: number; water: number }>> = {
  '2024-01': {
    'A区块': { oil: 2586, water: 7340 },
    'B区块': { oil: 3245, water: 9120 },
    'C区块': { oil: 4123, water: 11750 },
    'D区块': { oil: 1856, water: 5040 },
    'E区块': { oil: 776, water: 1991 }
  },
  '2023-12': {
    'A区块': { oil: 2400, water: 6917 },
    'B区块': { oil: 3000, water: 9466 },
    'C区块': { oil: 3800, water: 12378 },
    'D区块': { oil: 1700, water: 5279 },
    'E区块': { oil: 700, water: 2366 }
  }
}

const NULL_CELLS: { date: string; name: string; fields: string[] }[] = [
  { date: '2024-01-22', name: 'B-03井', fields: ['gasProduction'] },
  { date: '2024-01-05', name: 'E-01井', fields: ['waterProduction', 'gasProduction', 'waterCut'] },
  { date: '2024-01-28', name: 'D-05井', fields: ['oilProduction', 'waterProduction', 'gasProduction', 'waterCut', 'workingHours'] },
  { date: '2023-12-19', name: 'C-02井', fields: ['oilProduction', 'waterProduction', 'gasProduction', 'waterCut', 'workingHours'] }
]

// ---- 确定性伪随机（同输入永远同结果，保证报表可复现） ----

function hashSeed(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function seededRandom(seed: string): () => number {
  let s = hashSeed(seed)
  return () => {
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const round1 = (v: number) => Math.round(v * 10) / 10
const round0 = (v: number) => Math.round(v)

function monthDates(month: string): string[] {
  const [year, mon] = month.split('-').map(Number)
  const days = new Date(year, mon, 0).getDate()
  return Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`)
}

function isNullCell(date: string, name: string, field: string): boolean {
  return NULL_CELLS.some((c) => c.date === date && c.name === name && c.fields.includes(field))
}

/**
 * 按权重把当天总量拆给各井（保留指定小数），尾差补到取值最大的井，
 * 保证分项之和与总量完全一致；总量偏小时按权重顺序消化尾差，避免负数。
 */
function splitDayTotal(total: number, weights: number[], decimals: number): number[] {
  const factor = 10 ** decimals
  const sumW = weights.reduce((a, b) => a + b, 0)
  const values = weights.map((w) => Math.round((total * w) / sumW * factor) / factor)
  let diff = Math.round((total - values.reduce((a, b) => a + b, 0)) * factor) / factor
  while (diff !== 0) {
    const order = values
      .map((v, i) => [v, i] as [number, number])
      .sort((a, b) => (diff > 0 ? b[0] - a[0] : a[0] - b[0]))
    const step = diff > 0 ? 1 / factor : -1 / factor
    let moved = false
    for (const [, idx] of order) {
      if (diff > 0 || values[idx] + step >= 0) {
        values[idx] = Math.round((values[idx] + step) * factor) / factor
        diff = Math.round((diff - step) * factor) / factor
        moved = true
        break
      }
    }
    if (!moved) break
  }
  return values
}

/** 生成生产类报表（daily / weekly / monthly 共用）的两个月明细 */
function buildProductionRows(): RawRow[] {
  const rows: RawRow[] = []

  for (const month of ['2023-12', '2024-01']) {
    const dates = monthDates(month)
    const targets = BLOCK_MONTH_TARGETS[month]

    // 先建空壳行
    for (const date of dates) {
      for (const well of PROD_WELLS) {
        rows.push({
          date,
          name: well.name,
          group: well.group,
          oilProduction: null,
          waterProduction: null,
          gasProduction: null,
          waterCut: null,
          workingHours: null,
          status: '正常'
        })
      }
    }

    const getRow = (date: string, name: string) =>
      rows.find((r) => r.date === date && r.name === name) as RawRow

    // 1) 已知窗口日（1/10~1/20）：锚点日固定，其余按各井权重拆分日总量
    for (const date of dates) {
      const totals = WINDOW_DAY_TOTALS[date]
      if (!totals) continue
      if (date === ANCHOR_DAY) {
        for (const well of PROD_WELLS) {
          const a = ANCHOR_ROWS[well.name]
          const row = getRow(date, well.name)
          row.oilProduction = a.oil
          row.waterProduction = a.water
          row.gasProduction = a.gas
          row.workingHours = a.hours
          row.waterCut = a.cut
          row.status = a.status
        }
        continue
      }
      // E 井非锚点日占比固定（保证月度区块目标不被占比抖动击穿），其余井抖动后归一
      const eOil = round1(totals.oil * 0.11)
      const restOilWeights = PROD_WELLS.slice(0, 4).map((w, i) => {
        const base = [0.222, 0.174, 0.276, 0.151][i]
        return base * (0.88 + seededRandom(`${date}-oil-${w.name}`)() * 0.24)
      })
      const oilVals = splitDayTotal(totals.oil - eOil, restOilWeights, 1)
      PROD_WELLS.slice(0, 4).forEach((w, i) => { getRow(date, w.name).oilProduction = oilVals[i] })
      getRow(date, 'E-01井').oilProduction = eOil

      const eWater = round1(totals.water * 0.09)
      const restWaterWeights = PROD_WELLS.slice(0, 4).map((w, i) => {
        const base = [0.235, 0.195, 0.285, 0.188][i]
        return base * (0.88 + seededRandom(`${date}-water-${w.name}`)() * 0.24)
      })
      const waterVals = splitDayTotal(totals.water - eWater, restWaterWeights, 1)
      PROD_WELLS.slice(0, 4).forEach((w, i) => { getRow(date, w.name).waterProduction = waterVals[i] })
      getRow(date, 'E-01井').waterProduction = eWater
    }

    // 2) 其余日期：按区块月度目标减去窗口日已落地值，加权摊到剩余可用日期
    for (const well of PROD_WELLS) {
      for (const metric of ['oilProduction', 'waterProduction'] as const) {
        const key = metric === 'oilProduction' ? 'oil' : 'water'
        const windowSum = rows
          .filter((r) => r.group === well.group && WINDOW_DAY_TOTALS[r.date] && r[metric] !== null)
          .reduce((sum, r) => sum + (r[metric] as number), 0)
        const residual = round1(targets[well.group][key] - windowSum)

        const eligibleDates = dates.filter(
          (d) => !WINDOW_DAY_TOTALS[d] && !isNullCell(d, well.name, metric)
        )
        if (eligibleDates.length === 0) continue

        const weights = eligibleDates.map(
          (d) => 0.7 + seededRandom(`${month}-${well.name}-${metric}-${d}`)() * 0.6
        )
        const values = splitDayTotal(residual, weights, 1)
        eligibleDates.forEach((d, i) => { getRow(d, well.name)[metric] = values[i] })
      }
    }

    // 3) 气量、生产时长、含水率、状态
    for (const date of dates) {
      for (const well of PROD_WELLS) {
        const row = getRow(date, well.name)
        if (isNullCell(date, well.name, 'oilProduction')) {
          row.oilProduction = null
          row.waterProduction = null
          row.gasProduction = null
          row.waterCut = null
          row.workingHours = null
          row.status = '停机'
          continue
        }
        if (date === ANCHOR_DAY) continue

        if (isNullCell(date, well.name, 'waterProduction')) {
          row.waterProduction = null
          row.waterCut = null
        } else {
          row.waterCut = round1(
            (row.waterProduction as number) /
              ((row.oilProduction as number) + (row.waterProduction as number)) * 100
          )
        }
        row.gasProduction = isNullCell(date, well.name, 'gasProduction')
          ? null
          : round0((row.oilProduction as number) * (6.2 + seededRandom(`${date}-gas-${well.name}`)() * 1.6))
        row.workingHours = seededRandom(`${date}-hours-${well.name}`)() < 0.78 ? 24 : 22
        row.status = '正常'
      }
    }
  }

  return rows
}

// ---- 钻井 / 设备 / HSE 报表的确定性数据（结构与生产行一致，指标键不同） ----

interface SimpleSpec {
  key: string
  base: number
  spread: number
  decimals: number
  min?: number
}

function buildSimpleDataset(
  months: string[],
  entities: { name: string; group: string }[],
  specs: SimpleSpec[],
  seedKey: string,
  nullDates: Record<string, string[]> = {}
): RawRow[] {
  const rows: RawRow[] = []
  for (const month of months) {
    for (const date of monthDates(month)) {
      for (const entity of entities) {
        const row: RawRow = { date, name: entity.name, group: entity.group }
        for (const spec of specs) {
          const nulled = (nullDates[date] || []).includes(`${entity.name}.${spec.key}`)
          if (nulled) {
            row[spec.key] = null
            continue
          }
          const r = seededRandom(`${seedKey}-${date}-${entity.name}-${spec.key}`)()
          const factor = 10 ** spec.decimals
          let v = Math.round(spec.base * (1 - spec.spread + r * spec.spread * 2) * factor) / factor
          if (spec.min !== undefined && v < spec.min) v = spec.min
          row[spec.key] = v
        }
        rows.push(row)
      }
    }
  }
  return rows
}

const DRILLING_WELLS = [
  { name: 'A-01井', group: '钻井一队' },
  { name: 'B-03井', group: '钻井二队' },
  { name: 'C-02井', group: '钻井三队' }
]

const EQUIPMENT_LIST = [
  { name: '抽油机CYJ-01', group: '采油设备' },
  { name: '注水泵SB-02', group: '注水设备' },
  { name: '发电机FD-03', group: '动力设备' }
]

const HSE_WELLS = [
  { name: 'A-01井', group: 'A区块' },
  { name: 'C-02井', group: 'C区块' },
  { name: 'D-05井', group: 'D区块' }
]

function buildDrillingRows(): RawRow[] {
  return buildSimpleDataset(
    ['2023-12', '2024-01'],
    DRILLING_WELLS,
    [
      { key: 'footage', base: 82, spread: 0.35, decimals: 1, min: 0 },
      { key: 'rop', base: 8.2, spread: 0.3, decimals: 1, min: 0.5 },
      { key: 'drillingHours', base: 20, spread: 0.3, decimals: 0, min: 0 }
    ],
    'drilling',
    { '2024-01-09': ['B-03井.rop', 'B-03井.drillingHours'] }
  )
}

function buildEquipmentRows(): RawRow[] {
  return buildSimpleDataset(
    ['2023-12', '2024-01'],
    EQUIPMENT_LIST,
    [
      { key: 'runHours', base: 19.5, spread: 0.2, decimals: 1, min: 0 },
      { key: 'faultCount', base: 0.8, spread: 1.1, decimals: 0, min: 0 },
      { key: 'utilization', base: 92, spread: 0.06, decimals: 1, min: 0 }
    ],
    'equipment',
    { '2024-01-14': ['发电机FD-03.utilization'] }
  )
}

function buildHseRows(): RawRow[] {
  const base = buildSimpleDataset(
    ['2023-12', '2024-01'],
    HSE_WELLS,
    [
      { key: 'hazards', base: 5, spread: 0.7, decimals: 0, min: 0 },
      { key: 'trainingHours', base: 24, spread: 0.4, decimals: 0, min: 0 }
    ],
    'hse',
    { '2024-01-11': ['D-05井.hazards'] }
  )
  // 整改数由隐患数派生（同一行口径，不另造随机源）
  for (const row of base) {
    if (row.hazards === null) {
      row.rectified = null
    } else {
      const r = seededRandom(`hse-rect-${row.date}-${row.name}`)()
      row.rectified = Math.min(row.hazards as number, Math.max(0, Math.round((row.hazards as number) * (0.75 + r * 0.25))))
    }
  }
  return base
}

let cache: RawRow[] | null = null

/** 取全部报表共用的原始采集行（生产 / 钻井 / 设备 / HSE 同一张长表） */
export function getRawRows(): RawRow[] {
  if (cache) return cache
  cache = [
    ...buildProductionRows(),
    ...buildDrillingRows(),
    ...buildEquipmentRows(),
    ...buildHseRows()
  ]
  return cache
}
