<template>
  <div class="report-container">
    <el-card class="mb-20">
      <template #header>
        <div class="card-header">
          <span>报表中心</span>
          <div>
            <el-select v-model="reportType" placeholder="选择报表类型" style="width: 200px; margin-right: 10px;">
              <el-option label="生产日报" value="daily" />
              <el-option label="生产周报" value="weekly" />
              <el-option label="生产月报" value="monthly" />
              <el-option label="钻井进度报表" value="drilling" />
              <el-option label="设备运行报表" value="equipment" />
              <el-option label="HSE报表" value="hse" />
            </el-select>
            <el-date-picker
              v-model="dateRange"
              type="daterange"
              range-separator="至"
              start-placeholder="开始日期"
              end-placeholder="结束日期"
              value-format="YYYY-MM-DD"
              style="width: 300px; margin-right: 10px;"
            />
            <el-button type="primary" @click="handleQuery">查询</el-button>
            <el-button :loading="exporting" :disabled="!result || result.empty" @click="handleExport">导出Excel</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="20" class="mb-20">
        <el-col v-for="(card, idx) in summaryCards" :key="idx" :span="8">
          <div class="summary-card">
            <div class="summary-label">{{ card.label }}</div>
            <div class="summary-value">{{ card.value }}</div>
            <div class="summary-unit">{{ card.unit }}</div>
            <div class="summary-trend" :class="trendClass(card.trendUp)">
              <el-icon><TrendCharts /></el-icon>
              <span>{{ card.trendText }}</span>
            </div>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="20" class="mb-20">
        <el-col :span="16">
          <div class="chart-box">
            <h4>{{ trendTitle }}</h4>
            <div v-show="hasData" ref="trendChart" class="chart-large"></div>
            <el-empty v-if="!hasData" description="当前区间暂无数据" :image-size="80" class="chart-empty" />
          </div>
        </el-col>
        <el-col :span="8">
          <div class="chart-box">
            <h4>{{ pieTitle }}</h4>
            <div v-show="hasData" ref="pieChart" class="chart-medium"></div>
            <el-empty v-if="!hasData" description="当前区间暂无数据" :image-size="80" class="chart-empty" />
          </div>
        </el-col>
      </el-row>

      <div class="table-box">
        <h4>详细数据</h4>
        <el-table :data="tableRows" border stripe style="width: 100%">
          <el-table-column prop="dateLabel" :label="dateColumnLabel" width="130" />
          <el-table-column prop="name" :label="nameColumnLabel" width="120" />
          <el-table-column
            v-for="col in tableColumns"
            :key="col.key"
            :label="col.label"
            :width="col.key === 'waterCut' ? 140 : 130"
          >
            <template #default="{ row }">
              <el-progress
                v-if="col.key === 'waterCut' && typeof row.values[col.key] === 'number'"
                :percentage="row.values[col.key]"
                :stroke-width="10"
              />
              <span v-else>{{ cellText(row, col.key) }}</span>
            </template>
          </el-table-column>
          <el-table-column v-if="showStatus" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === '正常' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="当前区间暂无明细数据，请调整报表类型或日期区间" :image-size="80" />
          </template>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import {
  REPORT_CONFIGS,
  buildReport,
  exportReportCsv,
  formatCell,
  type ReportType,
  type ReportResult,
  type SummaryCard
} from './reportCore'

const PIE_COLORS = ['#3b82f6', '#22c55e', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4']

const reportType = ref<ReportType>('daily')
const dateRange = ref<[string, string] | null>(['2024-01-01', '2024-01-31'])
const result = ref<ReportResult | null>(null)

const trendChart = ref<HTMLElement>()
const pieChart = ref<HTMLElement>()
let trendInstance: echarts.ECharts | null = null
let pieInstance: echarts.ECharts | null = null
const exporting = ref(false)

const summaryCards = computed<SummaryCard[]>(() => result.value?.cards ?? [])
const tableRows = computed(() => result.value?.table ?? [])
const tableColumns = computed(() => result.value?.columns ?? [])
const showStatus = computed(() => result.value?.config.hasStatus ?? false)
const dateColumnLabel = computed(() => result.value?.config.dateLabel ?? '日期')
const nameColumnLabel = computed(() => result.value?.config.nameLabel ?? '名称')
const trendTitle = computed(() => result.value?.config.trendTitle ?? '趋势分析')
const pieTitle = computed(() => result.value?.config.pieTitle ?? '分组占比')
const hasData = computed(() => !!result.value && !result.value.empty)

function trendClass(up: boolean | null): string {
  if (up === null) return 'flat'
  return up ? 'up' : 'down'
}

function cellText(row: { values: Record<string, number | null> }, key: string): string {
  const metric = result.value?.config.metrics.find((m) => m.key === key)
  const value = row.values[key]
  if (!metric || value === null || value === undefined) return '—'
  return formatCell(value, metric)
}

/** 汇总 / 区块 / 明细 / 导出共用同一份 buildReport 结果，视图层不再自行计算任何指标 */
function refresh() {
  if (!result.value) return
  renderTrend()
  renderPie()
}

function renderTrend() {
  if (!trendInstance || !result.value) return
  if (!hasData.value) {
    trendInstance.clear()
    return
  }
  const { trend, config } = result.value
  trendInstance.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: [...config.trendSeriesNames] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: trend.labels },
    yAxis: { type: 'value' },
    series: [
      {
        name: config.trendSeriesNames[0],
        type: 'line',
        smooth: true,
        ...(config.stackTrend ? { stack: 'Total', areaStyle: { color: 'rgba(59,130,246,0.1)' } } : {}),
        data: trend.series[0].data,
        itemStyle: { color: '#3b82f6' },
        connectNulls: false
      },
      {
        name: config.trendSeriesNames[1],
        type: 'line',
        smooth: true,
        ...(config.stackTrend ? { stack: 'Total', areaStyle: { color: 'rgba(34,197,94,0.1)' } } : {}),
        data: trend.series[1].data,
        itemStyle: { color: '#22c55e' },
        connectNulls: false
      }
    ]
  }, true)
}

function renderPie() {
  if (!pieInstance || !result.value) return
  if (!hasData.value) {
    pieInstance.clear()
    return
  }
  const { pie, config } = result.value
  pieInstance.setOption({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left' },
    series: [{
      name: config.pieName,
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: `{b}: {c}${config.pieUnit}\n({d}%)` },
      emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' } },
      data: pie.map((slice, i) => ({
        value: slice.value,
        name: slice.name,
        itemStyle: { color: PIE_COLORS[i % PIE_COLORS.length] }
      }))
    }]
  }, true)
}

function handleQuery() {
  if (!dateRange.value || !dateRange.value[0] || !dateRange.value[1]) {
    ElMessage.warning('请先选择查询日期区间')
    return
  }
  const built = buildReport(reportType.value, dateRange.value)
  if (!built.result || !built.range) {
    ElMessage.warning('请先选择查询日期区间')
    return
  }
  // 区间接反：口径层静默对调，视图层只负责提示一次
  if (built.range.swapped) {
    ElMessage.warning('开始日期晚于结束日期，已自动按时间先后对调查询')
  }
  result.value = built.result
  refresh()
  if (built.result.empty) {
    ElMessage.info(`${REPORT_CONFIGS[reportType.value].label}在所选区间内暂无数据`)
  }
}

function handleExport() {
  if (!result.value || result.value.empty) {
    ElMessage.error('导出失败：当前区间没有可导出的数据')
    return
  }
  exporting.value = true
  try {
    const { filename, content } = exportReportCsv(result.value)
    const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    setTimeout(() => URL.revokeObjectURL(url), 1000)
    ElMessage.success('导出成功')
  } catch (e) {
    ElMessage.error(`导出失败：${e instanceof Error ? e.message : '请稍后重试'}`)
  } finally {
    exporting.value = false
  }
}

const handleResize = () => {
  trendInstance?.resize()
  pieInstance?.resize()
}

onMounted(() => {
  if (trendChart.value) trendInstance = echarts.init(trendChart.value)
  if (pieChart.value) pieInstance = echarts.init(pieChart.value)
  window.addEventListener('resize', handleResize)
  // 首屏口径与默认区间下的统一结果
  const built = buildReport(reportType.value, dateRange.value)
  result.value = built.result
  refresh()
})

onBeforeUnmount(() => {
  window.removeEventListener('resize', handleResize)
  trendInstance?.dispose()
  pieInstance?.dispose()
})
</script>

<style scoped lang="scss">
.report-container {
  width: 100%;
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-weight: 600;
}

.summary-card {
  background: linear-gradient(135deg, #f8fafc 0%, #e2e8f0 100%);
  border-radius: 8px;
  padding: 25px;
  text-align: center;

  .summary-label {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 10px;
  }

  .summary-value {
    font-size: 36px;
    font-weight: 700;
    color: #1e293b;
    line-height: 1;
  }

  .summary-unit {
    font-size: 14px;
    color: #64748b;
    margin-bottom: 10px;
  }

  .summary-trend {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 5px;
    font-size: 13px;

    &.up {
      color: #22c55e;
    }

    &.down {
      color: #ef4444;
    }

    &.flat {
      color: #94a3b8;
    }
  }
}

.chart-box, .table-box {
  background: #fff;
  border-radius: 8px;
  padding: 20px;

  h4 {
    margin: 0 0 15px 0;
    font-size: 16px;
    color: #1e293b;
  }
}

.chart-large {
  width: 100%;
  height: 280px;
}

.chart-medium {
  width: 100%;
  height: 280px;
}

.chart-empty {
  height: 280px;
  display: flex;
  flex-direction: column;
  justify-content: center;
}

.mb-20 {
  margin-bottom: 20px;
}
</style>
