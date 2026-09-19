import { supabase, hasSupabaseConfig } from './supabaseClient'
import {
  buildDetailRows,
  buildGeneralRows,
  RESULTS_EXPORT_DETAIL_COLUMNS,
  RESULTS_EXPORT_GENERAL_COLUMNS,
} from '../utils/resultsExportFormatting'

function ensureSupabase() {
  if (!hasSupabaseConfig || !supabase) throw new Error('La conexión con Supabase todavía no está configurada.')
}

function sanitizeFilename(value) {
  return String(value || 'resultados')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80) || 'resultados'
}

function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 1000)
}

function setSheetWidths(sheet, columns, rows, maxWidth = 42) {
  sheet['!cols'] = columns.map((column) => {
    const values = [column, ...rows.slice(0, 200).map((row) => row?.[column])]
    const width = values.reduce((current, value) => {
      if (value instanceof Date) return Math.max(current, 19)
      const lines = String(value ?? '').split(/\r?\n/)
      return Math.max(current, ...lines.map((line) => line.length))
    }, 10)
    return { wch: Math.min(maxWidth, Math.max(10, width + 2)) }
  })
}

function worksheetFromRows(XLSX, rows, columns, options = {}) {
  const sheet = rows.length
    ? XLSX.utils.json_to_sheet(rows, {
        header: columns,
        cellDates: true,
        dateNF: 'yyyy-mm-dd hh:mm:ss',
        skipHeader: false,
      })
    : XLSX.utils.aoa_to_sheet([columns])
  const lastColumn = XLSX.utils.encode_col(columns.length - 1)
  const lastRow = Math.max(1, rows.length + 1)
  sheet['!autofilter'] = { ref: `A1:${lastColumn}${lastRow}` }
  setSheetWidths(sheet, columns, rows, options.maxWidth || 42)
  if (options.dateColumns) {
    options.dateColumns.forEach((column) => {
      const columnIndex = columns.indexOf(column)
      if (columnIndex < 0) return
      rows.forEach((row, index) => {
        if (!(row?.[column] instanceof Date)) return
        const ref = XLSX.utils.encode_cell({ c: columnIndex, r: index + 1 })
        if (sheet[ref]) sheet[ref].z = 'yyyy-mm-dd hh:mm:ss'
      })
    })
  }
  return sheet
}

function csvBlob(XLSX, sheet) {
  const csv = XLSX.utils.sheet_to_csv(sheet, { FS: ',', RS: '\r\n' })
  return new Blob([`\ufeff${csv}`], { type: 'text/csv;charset=utf-8' })
}

export async function getExamExportDetails(examId) {
  ensureSupabase()
  if (!examId) throw new Error('Selecciona un examen antes de exportar.')
  const { data, error } = await supabase.rpc('get_exam_export_details', { p_exam_id: examId })
  if (error) throw error
  return Array.isArray(data) ? data : []
}

export async function exportExamResultsExcel({ exam, students, details }) {
  if (!exam?.id) throw new Error('Selecciona un examen antes de exportar.')
  const XLSX = await import('xlsx')
  const generalRows = buildGeneralRows({ exam, students })
  const detailRows = buildDetailRows({ details })
  const workbook = XLSX.utils.book_new()
  const generalSheet = worksheetFromRows(XLSX, generalRows, RESULTS_EXPORT_GENERAL_COLUMNS, { dateColumns: ['Inicio', 'Fin'] })
  const detailSheet = worksheetFromRows(XLSX, detailRows, RESULTS_EXPORT_DETAIL_COLUMNS, { maxWidth: 55 })
  XLSX.utils.book_append_sheet(workbook, generalSheet, 'Resultados')
  XLSX.utils.book_append_sheet(workbook, detailSheet, 'Detalle')
  workbook.Props = {
    Title: `Resultados - ${exam.title || 'Examen'}`,
    Subject: 'Exportación de resultados de evaluación',
    Author: 'Desafío Industrial · Ingeniería Industrial UNSA',
    CreatedDate: new Date(),
  }
  const filename = `Resultados_${sanitizeFilename(exam.title)}.xlsx`
  XLSX.writeFile(workbook, filename, { compression: true, cellDates: true })
  return { filename, generalCount: generalRows.length, detailCount: detailRows.length }
}

export async function exportExamResultsCsv({ exam, students, details, mode = 'general' }) {
  if (!exam?.id) throw new Error('Selecciona un examen antes de exportar.')
  const XLSX = await import('xlsx')
  const base = sanitizeFilename(exam.title)
  if (mode === 'detail') {
    const rows = buildDetailRows({ details })
    const sheet = worksheetFromRows(XLSX, rows, RESULTS_EXPORT_DETAIL_COLUMNS, { maxWidth: 55 })
    const filename = `Resultados_${base}_detalle.csv`
    triggerDownload(csvBlob(XLSX, sheet), filename)
    return { filename, rowCount: rows.length }
  }
  const rows = buildGeneralRows({ exam, students })
  const sheet = worksheetFromRows(XLSX, rows, RESULTS_EXPORT_GENERAL_COLUMNS, { dateColumns: ['Inicio', 'Fin'] })
  const filename = `Resultados_${base}_general.csv`
  triggerDownload(csvBlob(XLSX, sheet), filename)
  return { filename, rowCount: rows.length }
}
