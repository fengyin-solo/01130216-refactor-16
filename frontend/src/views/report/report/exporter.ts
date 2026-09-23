/**
 * Excel 导出（零依赖）
 *
 * 导出不另取数、不另算指标：直接消费 engine.buildReport 产出的同一份
 * ReportResult，列定义与数值格式与明细表完全一致（DETAIL_COLUMNS /
 * formatMetric），从根本上保证"导出文件"与页面同口径。
 */
import { DETAIL_COLUMNS, formatMetric, METRIC_META } from './metrics'
import { REPORT_TYPE_OPTIONS } from './scope'
import type { MetricKey, RawRecord, ReportResult } from './types'

export class ExportError extends Error {}

/** 浏览器落地函数抽离出来，便于在无 DOM 环境测试与失败注入 */
export type FileSaver = (blob: Blob, filename: string) => void

const defaultSaver: FileSaver = (blob, filename) => {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  // 释放放到下一帧，避免个别浏览器下载尚未开始即回收
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

function escapeCell(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
}

function cellText(record: RawRecord, prop: keyof RawRecord): string {
  switch (prop) {
    case 'date':
    case 'wellName':
    case 'status':
      return String(record[prop] ?? '')
    default:
      return formatMetric(record, prop as MetricKey)
  }
}

function buildHtml(result: ReportResult): string {
  const header = DETAIL_COLUMNS.map((c) => `<th>${escapeCell(c.label)}</th>`).join('')
  const rows = result.records
    .map(
      (record) =>
        '<tr>' +
        DETAIL_COLUMNS.map((c) => `<td>${escapeCell(cellText(record, c.prop))}</td>`).join('') +
        '</tr>'
    )
    .join('')

  // Excel 可识别的 HTML 表格，charset + BOM 保证中文不乱码
  return (
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" ' +
    'xmlns:x="urn:schemas-microsoft-com:office:excel" ' +
    'xmlns="http://www.w3.org/TR/REC-html40">' +
    '<head><meta charset="UTF-8" /></head><body>' +
    `<table border="1"><thead><tr>${header}</tr></thead>` +
    `<tbody>${rows}</tbody></table></body></html>`
  )
}

function buildFilename(result: ReportResult): string {
  const label =
    REPORT_TYPE_OPTIONS.find((o) => o.value === result.scope.type)?.label ?? '报表'
  return `${label}_${result.scope.aggregate.start}_${result.scope.aggregate.end}.xls`
}

/**
 * 导出当前报表结果。
 * 无数据时抛 ExportError 并由调用方提示；落地失败（磁盘/浏览器拦截等）
 * 同样包装为 ExportError，页面不产生假成功。
 */
export async function exportReport(
  result: ReportResult,
  saver: FileSaver = defaultSaver
): Promise<void> {
  if (result.empty || result.records.length === 0) {
    throw new ExportError('当前区间无数据可导出')
  }
  try {
    // UTF-8 BOM（﻿）让 Excel 正确识别中文；独立 ArrayBuffer 避免 Blob 取到底层缓冲
    const bomBuffer = new ArrayBuffer(3)
    new Uint8Array(bomBuffer).set([0xef, 0xbb, 0xbf])
    const blob = new Blob([bomBuffer, buildHtml(result)], {
      type: 'application/vnd.ms-excel;charset=utf-8'
    })
    saver(blob, buildFilename(result))
  } catch (cause) {
    throw new ExportError(
      cause instanceof Error ? `导出失败：${cause.message}` : '导出失败，请重试'
    )
  }
}

/** 供导出预览 / 测试复用：导出的列头文案（与 METRIC_META 同源） */
export function exportHeaders(): string[] {
  return DETAIL_COLUMNS.map((c) =>
    c.prop in METRIC_META ? METRIC_META[c.prop as MetricKey].label : c.label
  )
}
