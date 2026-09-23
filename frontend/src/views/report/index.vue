<template>
  <div class="report-container">
    <el-card class="mb-20">
      <template #header>
        <div class="card-header">
          <span>报表中心</span>
          <div>
            <el-select v-model="reportType" placeholder="选择报表类型" style="width: 200px; margin-right: 10px;">
              <el-option v-for="item in reportTypeOptions" :key="item.value" :label="item.label" :value="item.value" />
            </el-select>
            <el-date-picker v-model="dateRange" type="daterange" value-format="YYYY-MM-DD" range-separator="至" start-placeholder="开始日期" end-placeholder="结束日期" style="width: 300px; margin-right: 10px;" />
            <el-button type="primary" :loading="loading" @click="handleQuery">查询</el-button>
            <el-button :loading="exporting" @click="handleExport">导出Excel</el-button>
          </div>
        </div>
      </template>

      <el-row :gutter="20" class="mb-20">
        <el-col :span="8">
          <div class="summary-card">
            <div class="summary-label">总产油量</div>
            <div class="summary-value">{{ summaryOil }}</div>
            <div class="summary-unit">吨</div>
            <div class="summary-trend up">
              <el-icon><TrendCharts /></el-icon>
              <span>较上期 {{ oilDeltaText }}</span>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="summary-card">
            <div class="summary-label">总产水量</div>
            <div class="summary-value">{{ summaryWater }}</div>
            <div class="summary-unit">吨</div>
            <div class="summary-trend down">
              <el-icon><TrendCharts /></el-icon>
              <span>较上期 {{ waterDeltaText }}</span>
            </div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="summary-card">
            <div class="summary-label">平均含水率</div>
            <div class="summary-value">{{ summaryWaterCut }}</div>
            <div class="summary-unit">%</div>
            <div class="summary-trend up">
              <el-icon><TrendCharts /></el-icon>
              <span>较上期 {{ waterCutDeltaText }}</span>
            </div>
          </div>
        </el-col>
      </el-row>

      <el-row :gutter="20" class="mb-20">
        <el-col :span="16">
          <div class="chart-box">
            <h4>产量趋势分析</h4>
            <div ref="trendChart" class="chart-large"></div>
          </div>
        </el-col>
        <el-col :span="8">
          <div class="chart-box">
            <h4>区块产量占比</h4>
            <div ref="pieChart" class="chart-medium"></div>
          </div>
        </el-col>
      </el-row>

      <div class="table-box">
        <h4>详细数据</h4>
        <el-table :data="reportData" border stripe style="width: 100%">
          <el-table-column prop="date" label="日期" width="120" />
          <el-table-column prop="wellName" label="井名" width="100" />
          <el-table-column prop="oilProduction" label="产油量(t)" width="120">
            <template #default="{ row }">{{ cellText(row, 'oilProduction') }}</template>
          </el-table-column>
          <el-table-column prop="waterProduction" label="产水量(t)" width="120">
            <template #default="{ row }">{{ cellText(row, 'waterProduction') }}</template>
          </el-table-column>
          <el-table-column prop="gasProduction" label="产气量(m³)" width="120">
            <template #default="{ row }">{{ cellText(row, 'gasProduction') }}</template>
          </el-table-column>
          <el-table-column prop="waterCut" label="含水率(%)" width="120">
            <template #default="{ row }">
              <el-progress :percentage="row.waterCut ?? 0" :stroke-width="10" />
            </template>
          </el-table-column>
          <el-table-column prop="workingHours" label="生产时长(h)" width="120">
            <template #default="{ row }">{{ cellText(row, 'workingHours') }}</template>
          </el-table-column>
          <el-table-column prop="status" label="状态" width="100">
            <template #default="{ row }">
              <el-tag :type="row.status === '正常' ? 'success' : 'warning'" size="small">{{ row.status }}</el-tag>
            </template>
          </el-table-column>
          <template #empty>
            <el-empty description="当前区间暂无数据" :image-size="80" />
          </template>
        </el-table>
      </div>
    </el-card>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onBeforeUnmount, nextTick } from 'vue'
import * as echarts from 'echarts'
import { ElMessage } from 'element-plus'
import {
  REPORT_TYPE_OPTIONS,
  resolveScope,
  buildReport,
  exportReport,
  ExportError,
  formatNumber,
  formatDelta,
  formatTrendValue,
  formatMetric,
  EMPTY_TEXT
} from './report'
import type { ReportResult, ReportType, MetricKey, RawRecord } from './report'

const reportType = ref<ReportType>('daily')
const dateRange = ref<[string, string] | null>(null)
const trendChart = ref<HTMLElement>()
const pieChart = ref<HTMLElement>()

const reportTypeOptions = REPORT_TYPE_OPTIONS
const loading = ref(false)
const exporting = ref(false)
const reportResult = ref<ReportResult | null>(null)

const reportData = computed<RawRecord[]>(() => reportResult.value?.records ?? [])

const summaryOil = computed(() =>
  formatNumber(reportResult.value?.summary.totalOil ?? null, 0)
)
const summaryWater = computed(() =>
  formatNumber(reportResult.value?.summary.totalWater ?? null, 0)
)
const summaryWaterCut = computed(() =>
  formatNumber(reportResult.value?.summary.avgWaterCut ?? null, 2)
)
const oilDeltaText = computed(() =>
  formatDelta(reportResult.value?.summary.oilDelta ?? null)
)
const waterDeltaText = computed(() =>
  formatDelta(reportResult.value?.summary.waterDelta ?? null)
)
const waterCutDeltaText = computed(() =>
  formatDelta(reportResult.value?.summary.waterCutDelta ?? null)
)

/** 明细单元格：与导出共用 formatMetric，空值统一显示 -- */
const cellText = (row: RawRecord, key: MetricKey) => formatMetric(row, key)

let trendInstance: echarts.ECharts | null = null
let pieInstance: echarts.ECharts | null = null

const renderTrendChart = () => {
  if (!trendChart.value) return
  if (!trendInstance) trendInstance = echarts.init(trendChart.value)
  const trend = reportResult.value?.trend ?? []
  trendInstance.setOption({
    tooltip: { trigger: 'axis' },
    legend: { data: ['产油量', '产水量'] },
    grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
    xAxis: { type: 'category', boundaryGap: false, data: trend.map((p) => p.label) },
    yAxis: { type: 'value' },
    series: [
      {
        name: '产油量',
        type: 'line',
        smooth: true,
        stack: 'Total',
        areaStyle: { color: 'rgba(59,130,246,0.1)' },
        data: trend.map((p) => formatTrendValue(p.oil)),
        itemStyle: { color: '#3b82f6' }
      },
      {
        name: '产水量',
        type: 'line',
        smooth: true,
        stack: 'Total',
        areaStyle: { color: 'rgba(34,197,94,0.1)' },
        data: trend.map((p) => formatTrendValue(p.water)),
        itemStyle: { color: '#22c55e' }
      }
    ]
  }, true)
}

const renderPieChart = () => {
  if (!pieChart.value) return
  if (!pieInstance) pieInstance = echarts.init(pieChart.value)
  const blocks = reportResult.value?.blocks ?? []
  pieInstance.setOption({
    tooltip: { trigger: 'item' },
    legend: { orient: 'vertical', left: 'left' },
    graphic: blocks.length
      ? undefined
      : { type: 'text', left: 'center', top: 'middle', style: { text: EMPTY_TEXT, fill: '#94a3b8', fontSize: 14 } },
    series: [{
      name: '区块产量',
      type: 'pie',
      radius: ['40%', '70%'],
      avoidLabelOverlap: false,
      itemStyle: { borderRadius: 10, borderColor: '#fff', borderWidth: 2 },
      label: { show: true, formatter: '{b}: {c}t\n({d}%)' },
      emphasis: { label: { show: true, fontSize: 16, fontWeight: 'bold' } },
      data: blocks
    }]
  }, true)
}

const renderCharts = () => {
  nextTick(() => {
    renderTrendChart()
    renderPieChart()
  })
}

const handleResize = () => {
  trendInstance?.resize()
  pieInstance?.resize()
}

/** 查询：时间口径（含区间接反归一）只走 resolveScope 一处 */
const handleQuery = async () => {
  const scope = resolveScope(reportType.value, dateRange.value)
  if (scope.reversed) {
    ElMessage.warning('开始日期晚于结束日期，已自动按升序查询')
  }
  loading.value = true
  try {
    reportResult.value = await buildReport(scope)
    renderCharts()
    if (reportResult.value.empty) {
      ElMessage.info('当前区间暂无数据')
    }
  } finally {
    loading.value = false
  }
}

/** 导出：直接消费查询得到的同一份结果，失败给出明确提示 */
const handleExport = async () => {
  if (!reportResult.value) return
  exporting.value = true
  try {
    await exportReport(reportResult.value)
  } catch (error) {
    const message = error instanceof ExportError ? error.message : '导出失败，请重试'
    ElMessage.error(message)
  } finally {
    exporting.value = false
  }}

onMounted(async () => {
  window.addEventListener('resize', handleResize)
  // 默认加载生产日报口径，首屏数值与原静态报表一致
  await handleQuery()
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

.mb-20 {
  margin-bottom: 20px;
}
</style>
