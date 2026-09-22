import JSZip from 'jszip'
import { downloadBlob, safePdfFilename } from '../utils/simplePdf'
import { formatCorrectResponse, formatResponse, secondsToClock } from '../utils/resultsExportFormatting'

const PAGE = { width: 1240, height: 1754, margin: 28 }
const COLORS = {
  maroon: '#5E151D',
  navy: '#141E42',
  gray: '#999999',
  lightGray: '#F1F4F7',
  line: '#C8D0DA',
  text: '#17223A',
  green: '#19783A',
  greenBg: '#EAF6ED',
  red: '#A71930',
  redBg: '#FBECEF',
  amber: '#936A00',
  amberBg: '#FFF6D9',
  white: '#FFFFFF',
}

const LOGOS = {
  unsa: '/branding/unsa-report-logo.jpg',
  industrial: '/branding/industrial-unsa-report-logo.jpg',
}

function number(value, digits = 1) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  return Number(value).toLocaleString('es-PE', { minimumFractionDigits: digits, maximumFractionDigits: digits })
}

function compactNumber(value, digits = 2) {
  if (value == null || Number.isNaN(Number(value))) return '—'
  const n = Number(value)
  return Number.isInteger(n) ? String(n) : n.toLocaleString('es-PE', { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

function dateOnly(value) {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat('es-PE', { day: '2-digit', month: '2-digit', year: 'numeric' }).format(new Date(value)) } catch { return String(value) }
}

function timeOnly(value) {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat('es-PE', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) } catch { return String(value) }
}

function dateTime(value) {
  if (!value) return '—'
  try { return new Intl.DateTimeFormat('es-PE', { dateStyle: 'short', timeStyle: 'medium' }).format(new Date(value)) } catch { return String(value) }
}

function elapsedSeconds(startedAt, endedAt, fallback = null) {
  if (fallback != null && Number.isFinite(Number(fallback))) return Math.max(0, Number(fallback))
  if (!startedAt || !endedAt) return null
  const ms = new Date(endedAt).getTime() - new Date(startedAt).getTime()
  return Number.isFinite(ms) && ms >= 0 ? Math.round(ms / 1000) : null
}

function elapsedLabel(seconds) {
  if (seconds == null || !Number.isFinite(Number(seconds))) return '—'
  const total = Math.max(0, Math.round(Number(seconds)))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours) return `${hours} h ${minutes} min`
  if (minutes) return `${minutes} min ${secs} s`
  return `${secs} s`
}

function statusLabel(status, submissionReason) {
  if (submissionReason === 'TEACHER_FORCED') return 'FINALIZADO POR DOCENTE'
  if (status === 'time_expired' || submissionReason === 'TIME_EXPIRED') return 'TIEMPO AGOTADO'
  if (status === 'submitted') return 'FINALIZADO'
  if (status === 'cancelled') return 'CANCELADO'
  return String(status || 'FINALIZADO').toUpperCase()
}

function submissionLabel(status, submissionReason) {
  if (submissionReason === 'TEACHER_FORCED') return 'Finalización remota realizada por el docente'
  if (submissionReason === 'TEACHER_FORCED_BEFORE_START') return 'Cancelado por el docente antes del inicio'
  if (status === 'time_expired' || submissionReason === 'TIME_EXPIRED') return 'Tiempo de evaluación agotado'
  if (submissionReason === 'STUDENT_SUBMITTED') return 'Envío realizado por el estudiante'
  return 'Intento cerrado'
}

function gradeCapFromExam(exam) {
  const cfg = Array.isArray(exam?.configuraciones_examen) ? exam.configuraciones_examen[0] : exam?.configuraciones_examen
  const scale = Number(cfg?.grade_scale_max ?? 20)
  const cap = Number(cfg?.settings?.grading?.finalGradeCap ?? scale)
  return {
    scale: Number.isFinite(scale) && scale > 0 ? scale : 20,
    cap: Number.isFinite(cap) && cap > 0 ? Math.min(cap, Number.isFinite(scale) && scale > 0 ? scale : 20) : 20,
  }
}

function gradeNumbers({ finalGrade, rawScore, maxRawScore, scale = 20, cap = 20, uncappedFinalGrade = null, allowCalculatedFallback = true }) {
  const raw = Number(rawScore)
  const max = Number(maxRawScore)
  const directPointScale = Number.isFinite(max) && max > 0 && Number.isFinite(Number(cap)) && Math.abs(max - Number(cap)) <= 0.001
  const calculated = directPointScale && Number.isFinite(raw)
    ? raw
    : uncappedFinalGrade != null && Number.isFinite(Number(uncappedFinalGrade))
      ? Number(uncappedFinalGrade)
      : (Number.isFinite(raw) && Number.isFinite(max) && max > 0 ? (raw / max) * scale : null)
  const stored = finalGrade == null || !Number.isFinite(Number(finalGrade)) ? null : Number(finalGrade)
  const final = stored != null
    ? stored
    : (allowCalculatedFallback && calculated != null ? Math.min(calculated, cap) : null)
  const percent = Number.isFinite(raw) && Number.isFinite(max) && max > 0 ? (raw / max) * 100 : null
  return { calculated, final, finalGrade: final, percent, directPointScale }
}

function publicStudentCode(value) {
  const text = String(value || '').trim()
  if (!text || /^NAME-[A-F0-9]+$/i.test(text)) return '—'
  return text
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => resolve(null)
    image.src = src
  })
}

let logoPromise = null
function loadReportLogos() {
  if (!logoPromise) logoPromise = Promise.all([loadImage(LOGOS.unsa), loadImage(LOGOS.industrial)])
  return logoPromise
}

function createCanvas() {
  const canvas = document.createElement('canvas')
  canvas.width = PAGE.width
  canvas.height = PAGE.height
  const ctx = canvas.getContext('2d')
  ctx.fillStyle = COLORS.white
  ctx.fillRect(0, 0, PAGE.width, PAGE.height)
  ctx.textBaseline = 'top'
  return { canvas, ctx }
}

function wrapText(ctx, text, maxWidth) {
  const source = String(text ?? '').replace(/\r/g, '').split('\n')
  const result = []
  source.forEach((paragraph, paragraphIndex) => {
    if (!paragraph.trim()) {
      result.push('')
      return
    }
    const words = paragraph.trim().split(/\s+/)
    let line = ''
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word
      if (!line || ctx.measureText(candidate).width <= maxWidth) line = candidate
      else {
        result.push(line)
        line = word
      }
    })
    if (line) result.push(line)
    if (paragraphIndex < source.length - 1) result.push('')
  })
  return result
}

function roundRect(ctx, x, y, width, height, radius = 8, fill = null, stroke = null) {
  const r = Math.min(radius, width / 2, height / 2)
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + width, y, x + width, y + height, r)
  ctx.arcTo(x + width, y + height, x, y + height, r)
  ctx.arcTo(x, y + height, x, y, r)
  ctx.arcTo(x, y, x + width, y, r)
  ctx.closePath()
  if (fill) { ctx.fillStyle = fill; ctx.fill() }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1.5; ctx.stroke() }
}

function drawCentered(ctx, text, centerX, y, font, color = COLORS.text) {
  ctx.font = font
  ctx.fillStyle = color
  const width = ctx.measureText(String(text)).width
  ctx.fillText(String(text), centerX - width / 2, y)
}

function drawWrapped(ctx, text, x, y, maxWidth, { font = '24px Arial', color = COLORS.text, lineHeight = 31, bold = false } = {}) {
  ctx.font = bold ? font.replace('px ', 'px Arial, ').replace('Arial, Arial', 'Arial') : font
  ctx.fillStyle = color
  const lines = wrapText(ctx, text, maxWidth)
  lines.forEach((line, index) => ctx.fillText(line, x, y + index * lineHeight))
  return lines.length * lineHeight
}

function font(size, weight = 400, family = 'Arial') {
  return `${weight} ${size}px ${family}`
}

class ReportPainter {
  constructor(logos) {
    this.pages = []
    this.logos = logos
    this.page = null
    this.ctx = null
    this.y = 0
    this.firstPage = true
  }

  newPage({ first = false, examTitle = '', studentName = '' } = {}) {
    const { canvas, ctx } = createCanvas()
    this.pages.push(canvas)
    this.page = canvas
    this.ctx = ctx
    this.firstPage = first
    if (first) this.drawInstitutionalHeader()
    else this.drawContinuationHeader(examTitle, studentName)
  }

  drawInstitutionalHeader() {
    const ctx = this.ctx
    const [unsa, industrial] = this.logos
    // Reserve three independent columns so neither logo can collide with the
    // institutional text. The JPEGs already include their own wordmarks.
    if (unsa) ctx.drawImage(unsa, 34, 28, 286, 126)
    if (industrial) ctx.drawImage(industrial, 920, 28, 286, 126)

    const centerX = PAGE.width / 2
    const centerLeft = 344
    const centerRight = 896
    ctx.fillStyle = COLORS.navy
    const university = ['UNIVERSIDAD NACIONAL DE', 'SAN AGUSTÍN DE AREQUIPA']
    university.forEach((line, index) => drawCentered(ctx, line, centerX, 30 + index * 31, font(24, 700, 'Georgia'), COLORS.navy))
    ctx.strokeStyle = COLORS.maroon
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(centerLeft + 48, 94); ctx.lineTo(centerRight - 48, 94); ctx.stroke()
    drawCentered(ctx, 'FACULTAD DE INGENIERÍA DE PRODUCCIÓN Y SERVICIOS', centerX, 105, font(17, 700, 'Georgia'), COLORS.navy)
    drawCentered(ctx, 'ESCUELA PROFESIONAL DE INGENIERÍA INDUSTRIAL', centerX, 133, font(17, 700, 'Georgia'), COLORS.navy)
    this.y = 177
  }

  drawContinuationHeader(examTitle, studentName) {
    const ctx = this.ctx
    ctx.fillStyle = COLORS.navy
    ctx.font = font(18, 700)
    ctx.fillText('UNIVERSIDAD NACIONAL DE SAN AGUSTÍN DE AREQUIPA · INGENIERÍA INDUSTRIAL', 34, 28)
    ctx.fillStyle = COLORS.gray
    ctx.font = font(14, 400)
    ctx.fillText(`${examTitle || 'Evaluación'} · ${studentName || 'Estudiante'}`, 34, 55)
    ctx.strokeStyle = COLORS.maroon
    ctx.lineWidth = 3
    ctx.beginPath(); ctx.moveTo(34, 82); ctx.lineTo(PAGE.width - 34, 82); ctx.stroke()
    this.y = 105
  }

  ensure(height, meta) {
    if (this.y + height <= PAGE.height - 95) return
    this.newPage({ first: false, ...meta })
  }

  sectionBar(title, color = COLORS.navy) {
    this.ensure(52, {})
    this.ctx.fillStyle = color
    this.ctx.fillRect(28, this.y, PAGE.width - 56, 48)
    this.ctx.fillStyle = COLORS.white
    this.ctx.font = font(24, 700, 'Georgia')
    this.ctx.fillText(title, 46, this.y + 10)
    this.y += 60
  }

  titleBanner(title) {
    const ctx = this.ctx
    const text = String(title || 'EVALUACIÓN').toUpperCase()
    let size = 27
    let lines = []
    while (size >= 20) {
      ctx.font = font(size, 700, 'Georgia')
      lines = wrapText(ctx, text, PAGE.width - 120)
      if (lines.length <= 2) break
      size -= 1
    }
    const lineHeight = size + 8
    const height = Math.max(66, 24 + lines.length * lineHeight)
    ctx.fillStyle = COLORS.maroon
    ctx.fillRect(28, this.y, PAGE.width - 56, height)
    lines.slice(0, 2).forEach((line, index) => drawCentered(ctx, line, PAGE.width / 2, this.y + 12 + index * lineHeight, font(size, 700, 'Georgia'), COLORS.white))
    this.y += height + 14
  }

  dataTable(rows) {
    const x = 28
    const width = PAGE.width - 56
    const col = [0, 230, 650, 860, width]
    rows.forEach((row, index) => {
      let ctx = this.ctx
      const values = [row[0], row[1], row[2], row[3]]
      const prepared = values.map((value, cellIndex) => {
        const start = [col[0], col[1], col[2], col[3]][cellIndex]
        const maxW = ([col[1], col[2], col[3], col[4]][cellIndex] - start) - 24
        ctx.font = font(17, cellIndex % 2 === 0 ? 700 : 400)
        return wrapText(ctx, String(value ?? '—'), maxW)
      })
      const lineCount = Math.max(1, ...prepared.map((lines) => lines.length))
      const rowH = Math.max(44, 20 + lineCount * 20)
      this.ensure(rowH + 4, {})
      ctx = this.ctx
      const y = this.y
      ctx.fillStyle = index % 2 ? '#FAFBFC' : COLORS.white
      ctx.fillRect(x, y, width, rowH)
      ;[[0, 2]].forEach(([labelIndex]) => {
        const base = labelIndex === 0 ? col[0] : col[2]
        const end = labelIndex === 0 ? col[1] : col[3]
        ctx.fillStyle = COLORS.lightGray
        ctx.fillRect(x + base, y, end - base, rowH)
      })
      ctx.strokeStyle = COLORS.line
      ctx.lineWidth = 1
      ctx.strokeRect(x, y, width, rowH)
      col.slice(1, -1).forEach((cx) => { ctx.beginPath(); ctx.moveTo(x + cx, y); ctx.lineTo(x + cx, y + rowH); ctx.stroke() })
      prepared.forEach((lines, cellIndex) => {
        const start = [col[0], col[1], col[2], col[3]][cellIndex]
        ctx.fillStyle = COLORS.text
        ctx.font = font(17, cellIndex % 2 === 0 ? 700 : 400)
        lines.forEach((line, li) => ctx.fillText(line, x + start + 12, y + 10 + li * 20))
      })
      this.y += rowH
    })
    this.y += 18
  }

  resultAccessNotice(code) {
    if (!code) return
    const ctx = this.ctx
    const width = PAGE.width - 56
    const message = `Código personal de resultados: ${code}. Consérvalo y no lo compartas. Se solicitará para volver a ingresar y descargar tu examen corregido.`
    ctx.font = font(17, 700)
    const lines = wrapText(ctx, message, width - 38)
    const height = 28 + lines.length * 24
    this.ensure(height + 12, {})
    const nextCtx = this.ctx
    roundRect(nextCtx, 28, this.y, width, height, 7, '#EEF4FF', '#A9BCE8')
    nextCtx.fillStyle = COLORS.navy
    nextCtx.font = font(17, 700)
    lines.forEach((line, index) => nextCtx.fillText(line, 47, this.y + 14 + index * 24))
    this.y += height + 18
  }

  resultSummary(summary) {
    this.sectionBar('RESULTADO DE LA EVALUACIÓN', COLORS.maroon)
    const ctx = this.ctx
    const gap = 16
    const totalW = PAGE.width - 56
    const cardW = (totalW - gap * 3) / 4
    const cardH = 118
    const gradeLabel = summary.gradePending
      ? 'Pendiente'
      : summary.gradeAvailable === false && summary.finalGrade == null
        ? 'No publicada'
        : summary.finalGrade == null ? 'Pendiente' : number(summary.finalGrade, 1)
    const cards = [
      ['Nota final', gradeLabel, COLORS.maroon],
      ['Porcentaje', summary.percent == null ? '—' : `${number(summary.percent, 0)} %`, COLORS.navy],
      ['Respondidas', summary.totalQuestions ? `${summary.answered} de ${summary.totalQuestions}` : '—', COLORS.navy],
      ['Estado', summary.status, COLORS.green],
    ]
    cards.forEach(([label, value, tone], index) => {
      const x = 28 + index * (cardW + gap)
      roundRect(ctx, x, this.y, cardW, cardH, 8, index === 3 ? COLORS.greenBg : '#F9FBFD', COLORS.line)
      drawCentered(ctx, label, x + cardW / 2, this.y + 18, font(18, 700, 'Georgia'), COLORS.text)
      const valueSize = String(value).length > 12 ? 22 : 33
      drawCentered(ctx, value, x + cardW / 2, this.y + 54, font(index === 3 ? 22 : valueSize, 700), tone)
    })
    this.y += cardH + 15

    const stats = summary.correctnessVisible
      ? [
          ['Preguntas correctas', summary.totalQuestions ? String(summary.correct) : '—', COLORS.green],
          ['Preguntas incorrectas', summary.totalQuestions ? String(summary.incorrect) : '—', COLORS.red],
          ['Sin responder', summary.totalQuestions ? String(summary.omitted) : '—', COLORS.navy],
          ['Puntaje máximo del examen', compactNumber(summary.cap, 2), COLORS.maroon],
        ]
      : [
          ['Respuestas registradas', summary.totalQuestions ? String(summary.answered) : '—', COLORS.navy],
          ['Revisión manual pendiente', String(summary.pendingManualReviews || 0), COLORS.amber],
          ['Sin responder', summary.totalQuestions ? String(summary.omitted) : '—', COLORS.navy],
          ['Puntaje máximo del examen', compactNumber(summary.cap, 2), COLORS.maroon],
        ]
    const statsH = 86
    ctx.fillStyle = COLORS.lightGray
    ctx.fillRect(28, this.y, totalW, statsH)
    stats.forEach(([label, value, tone], index) => {
      const x = 28 + index * (totalW / 4)
      if (index) { ctx.strokeStyle = COLORS.line; ctx.beginPath(); ctx.moveTo(x, this.y + 16); ctx.lineTo(x, this.y + statsH - 16); ctx.stroke() }
      drawCentered(ctx, label, x + totalW / 8, this.y + 16, font(15, 700, 'Georgia'), COLORS.text)
      drawCentered(ctx, value, x + totalW / 8, this.y + 48, font(27, 700), tone)
    })
    this.y += statsH + 16

    let scoreText
    if (summary.gradePending) {
      scoreText = `Puntaje máximo del examen: ${compactNumber(summary.cap, 2)}. La nota final está pendiente hasta completar la revisión manual.`
    } else if (summary.finalGrade != null) {
      scoreText = `Puntaje obtenido: ${compactNumber(summary.rawScore, 2)} de ${compactNumber(summary.cap, 2)} puntos. Nota final: ${number(summary.finalGrade, 2)}. Los puntos obtenidos en cada pregunta se suman directamente para formar la nota final.`
    } else {
      scoreText = `Puntaje máximo del examen: ${compactNumber(summary.cap, 2)}. La nota final aún no se encuentra publicada.`
    }
    ctx.font = font(17, 700)
    const scoreLines = wrapText(ctx, scoreText, totalW - 38)
    const scoreH = 28 + scoreLines.length * 24
    roundRect(ctx, 28, this.y, totalW, scoreH, 7, COLORS.amberBg, '#E4C76D')
    ctx.fillStyle = COLORS.amber
    ctx.font = font(17, 700)
    scoreLines.forEach((line, index) => ctx.fillText(line, 47, this.y + 14 + index * 24))
    this.y += scoreH + 18
  }

  questionCard(question, meta) {
    const maxWidth = PAGE.width - 92
    let ctx = this.ctx
    ctx.font = font(20, 400)
    const promptLines = wrapText(ctx, question.prompt || 'Pregunta', maxWidth)
    ctx.font = font(16, 400)
    const answerLines = wrapText(ctx, question.studentAnswer || 'Omitida', maxWidth - 260)
    const correctLines = wrapText(ctx, question.correctAnswer || '—', maxWidth - 260)
    const feedbackLines = question.teacherFeedback ? wrapText(ctx, question.teacherFeedback, maxWidth - 260) : []
    const optionLines = Array.isArray(question.options) ? question.options.reduce((sum, option) => {
      ctx.font = font(17, 400)
      return sum + Math.max(1, wrapText(ctx, `${option.letter}. ${option.content}`, maxWidth - 60).length)
    }, 0) : 0
    const estimated = 54 + promptLines.length * 28 + (optionLines ? optionLines * 25 + 16 : 0) + (answerLines.length + correctLines.length) * 22 + (feedbackLines.length ? feedbackLines.length * 22 + 30 : 0) + 118
    this.ensure(Math.min(estimated, PAGE.height - 180), meta)
    // ensure() may create a new page. Always refresh the canvas context after it.
    ctx = this.ctx

    const y0 = this.y
    const tone = question.reviewStatus === 'pending' ? COLORS.amber : question.isCorrect === true ? COLORS.green : question.isCorrect === false ? COLORS.red : COLORS.navy
    const toneBg = question.reviewStatus === 'pending' ? COLORS.amberBg : question.isCorrect === true ? COLORS.greenBg : question.isCorrect === false ? COLORS.redBg : COLORS.lightGray

    ctx.fillStyle = COLORS.maroon
    ctx.fillRect(28, this.y, 200, 48)
    ctx.fillStyle = COLORS.white
    ctx.font = font(21, 700, 'Georgia')
    ctx.fillText(`PREGUNTA ${String(question.order).padStart(2, '0')}`, 48, this.y + 11)
    ctx.fillStyle = toneBg
    ctx.fillRect(228, this.y, PAGE.width - 256, 48)
    ctx.fillStyle = COLORS.navy
    ctx.font = font(18, 700)
    ctx.fillText(`Valor: ${compactNumber(question.maxScore, 2)} pts`, 830, this.y + 13)
    ctx.fillStyle = tone
    ctx.font = font(18, 700)
    const status = question.reviewStatus === 'pending' ? 'Revisión pendiente' : question.isCorrect === true ? '✓ Correcta' : question.isCorrect === false ? '✕ Incorrecta' : 'Respuesta registrada'
    ctx.fillText(status, 1030, this.y + 13)
    this.y += 62

    ctx.fillStyle = COLORS.text
    ctx.font = font(20, 400)
    promptLines.forEach((line, index) => ctx.fillText(line, 48, this.y + index * 28))
    this.y += promptLines.length * 28 + 14

    if (question.options?.length) {
      for (const option of question.options) {
        ctx.font = font(17, 400)
        const lines = wrapText(ctx, `${option.letter}. ${option.content}`, maxWidth - 60)
        const h = Math.max(32, lines.length * 24 + 8)
        const bg = option.selected ? (option.correct ? COLORS.greenBg : COLORS.redBg) : (option.correct ? '#F4FAF5' : COLORS.white)
        roundRect(ctx, 48, this.y, PAGE.width - 96, h, 6, bg, option.selected ? tone : COLORS.line)
        ctx.fillStyle = option.selected ? tone : COLORS.text
        ctx.font = font(17, option.selected ? 700 : 400)
        lines.forEach((line, index) => ctx.fillText(line, 62, this.y + 7 + index * 24))
        this.y += h + 6
      }
      this.y += 8
    }

    const rows = [
      ['Respuesta del estudiante', question.studentAnswer || 'Omitida'],
    ]
    if (question.correctAnswer) rows.push(['Respuesta correcta', question.correctAnswer])
    rows.push(['Puntos obtenidos', question.scorePending ? 'Pendiente de revisión' : question.scoreHidden ? 'Se mostrará al publicarse los resultados' : `${compactNumber(question.score, 2)} / ${compactNumber(question.maxScore, 2)} pts`])
    if (question.teacherFeedback) rows.push(['Retroalimentación', question.teacherFeedback])
    rows.forEach(([label, value]) => {
      ctx.font = font(16, 400)
      const lines = wrapText(ctx, value, PAGE.width - 430)
      const h = Math.max(38, 14 + lines.length * 21)
      ctx.fillStyle = COLORS.lightGray
      ctx.fillRect(48, this.y, 290, h)
      ctx.strokeStyle = COLORS.line
      ctx.strokeRect(48, this.y, PAGE.width - 96, h)
      ctx.beginPath(); ctx.moveTo(338, this.y); ctx.lineTo(338, this.y + h); ctx.stroke()
      ctx.fillStyle = COLORS.text
      ctx.font = font(16, 700)
      ctx.fillText(label, 62, this.y + 10)
      ctx.font = font(16, 400)
      lines.forEach((line, index) => ctx.fillText(line, 356, this.y + 9 + index * 21))
      this.y += h
    })
    this.y += 18
    ctx.strokeStyle = COLORS.line
    ctx.strokeRect(28, y0, PAGE.width - 56, this.y - y0 - 8)
  }

  addFooters() {
    const total = this.pages.length
    this.pages.forEach((canvas, index) => {
      const ctx = canvas.getContext('2d')
      ctx.strokeStyle = COLORS.maroon
      ctx.lineWidth = 2
      ctx.beginPath(); ctx.moveTo(28, PAGE.height - 62); ctx.lineTo(PAGE.width - 28, PAGE.height - 62); ctx.stroke()
      ctx.fillStyle = COLORS.navy
      ctx.font = font(13, 400)
      ctx.fillText('Ingeniería Industrial · UNSA', 42, PAGE.height - 42)
      drawCentered(ctx, 'Documento generado automáticamente', PAGE.width / 2, PAGE.height - 42, font(13, 400, 'Arial'), COLORS.gray)
      ctx.fillText(`Página ${index + 1} de ${total}`, PAGE.width - 126, PAGE.height - 42)
    })
  }
}

function selectedLetters(ids, options) {
  const selected = new Set((ids || []).map(String))
  return (options || []).map((option, index) => ({
    letter: String.fromCharCode(65 + index),
    content: option?.content || '',
    id: String(option?.id ?? ''),
    selected: selected.has(String(option?.id)),
  }))
}

function correctOptionIds(grading) {
  return new Set((grading?.correctOptionIds || []).map(String))
}

function displayCorrectAnswer(value) {
  const text = String(value || '').trim()
  if (!text || /revisi[oó]n manual/i.test(text)) return null
  return text
}

function teacherQuestions(details, attemptId) {
  return (details || []).filter((row) => row.attemptId === attemptId).map((row) => {
    const options = selectedLetters(row.selectedOptionIds, row.options)
    const correctIds = correctOptionIds(row.grading)
    options.forEach((option) => { option.correct = correctIds.has(option.id) })
    return {
      order: row.questionOrder,
      prompt: row.prompt,
      studentAnswer: formatResponse(row),
      correctAnswer: displayCorrectAnswer(formatCorrectResponse(row)),
      score: row.effectiveScore ?? 0,
      maxScore: row.points ?? 0,
      isCorrect: row.isCorrect,
      reviewStatus: row.reviewStatus,
      teacherFeedback: row.teacherFeedback,
      options: options.length ? options : null,
    }
  })
}

function studentQuestions(grading, reportDetails) {
  const rows = reportDetails?.details || grading?.details || []
  return rows.map((row) => ({
    order: row.order,
    prompt: row.prompt,
    studentAnswer: row.studentAnswer || 'Omitida',
    correctAnswer: row.correctAnswer || null,
    score: row.score == null ? null : Number(row.score),
    scorePending: row.reviewStatus === 'pending',
    scoreHidden: row.scoreHidden === true || (row.score == null && row.reviewStatus !== 'pending'),
    maxScore: row.maxScore ?? 0,
    isCorrect: typeof row.isCorrect === 'boolean' ? row.isCorrect : null,
    reviewStatus: row.reviewStatus,
    teacherFeedback: row.teacherFeedback,
    options: null,
  }))
}

function countQuestions(questions) {
  let correct = 0; let incorrect = 0; let omitted = 0; let answered = 0
  questions.forEach((row) => {
    const answer = String(row.studentAnswer || '').trim().toLowerCase()
    const isOmitted = !answer || answer === 'omitida' || answer === 'sin respuesta'
    if (isOmitted) {
      omitted += 1
      return
    }
    answered += 1
    if (row.isCorrect === true) correct += 1
    else if (row.isCorrect === false) incorrect += 1
  })
  return { correct, incorrect, omitted, answered, total: questions.length }
}

function resolvedPendingManualReviews(reportedValue, questions) {
  const manualRows = (questions || []).filter((row) => ['pending', 'reviewed'].includes(String(row.reviewStatus || '')))
  if (manualRows.length) return manualRows.filter((row) => row.reviewStatus === 'pending').length
  return Math.max(0, Number(reportedValue || 0))
}

function normalizeTeacherReport({ exam, student, details, teacherName }) {
  const questions = teacherQuestions(details, student?.attemptId)
  const counts = countQuestions(questions)
  const { scale, cap } = gradeCapFromExam(exam)
  const pendingManualReviews = student?.finalGrade != null
    ? 0
    : resolvedPendingManualReviews(student?.pendingManualReviews, questions)
  const grades = gradeNumbers({
    finalGrade: student?.finalGrade,
    rawScore: student?.rawScore,
    maxRawScore: student?.maxRawScore,
    scale,
    cap,
    allowCalculatedFallback: pendingManualReviews === 0,
  })
  return {
    examTitle: exam?.title || 'Evaluación',
    course: exam?.cursos?.name || '—',
    courseSection: student?.section || exam?.cursos?.section || '—',
    academicPeriod: exam?.cursos?.academic_period || '—',
    studentName: [student?.lastName, student?.firstName].filter(Boolean).join(', ') || 'Estudiante',
    studentCode: publicStudentCode(student?.studentCode),
    resultAccessCode: null,
    teacherName: teacherName || '—',
    attemptNumber: student?.attemptNumber || 1,
    startedAt: student?.startedAt,
    endedAt: student?.submittedAt || student?.deadlineAt,
    elapsedSeconds: student?.elapsedSeconds,
    status: student?.status,
    submissionReason: student?.submissionReason,
    securityIncidents: Number(student?.securityIncidents || 0),
    rawScore: student?.rawScore,
    maxRawScore: student?.maxRawScore,
    pendingManualReviews,
    gradePending: pendingManualReviews > 0,
    gradeAvailable: pendingManualReviews === 0,
    correctnessVisible: true,
    ...grades,
    questions,
    counts,
    scale,
    cap,
  }
}

function normalizeStudentReport(attemptData) {
  const student = attemptData?.student || {}
  const attempt = attemptData?.attempt || {}
  const exam = attemptData?.exam || {}
  const grading = attemptData?.grading || {}
  const reportDetails = attemptData?.reportDetails || null
  const questions = studentQuestions(grading, reportDetails)
  const counts = countQuestions(questions)
  const scale = Number(grading.gradeScaleMax ?? reportDetails?.gradeScaleMax ?? 20)
  const cap = Number(grading.finalGradeCap ?? reportDetails?.finalGradeCap ?? scale)
  const pendingManualReviews = grading.finalGrade != null
    ? 0
    : resolvedPendingManualReviews(grading.pendingManualReviews ?? reportDetails?.pendingManualReviews, questions)
  const gradeAvailable = grading.gradeAvailable === true || grading.finalGrade != null
  const grades = gradeNumbers({
    finalGrade: grading.finalGrade,
    rawScore: grading.rawScore,
    maxRawScore: grading.maxRawScore,
    scale,
    cap,
    uncappedFinalGrade: grading.uncappedFinalGrade,
    allowCalculatedFallback: gradeAvailable && pendingManualReviews === 0,
  })
  return {
    examTitle: exam.title || 'Evaluación',
    course: exam.course?.name || '—',
    courseSection: student.section || exam.course?.section || '—',
    academicPeriod: exam.course?.academicPeriod || '—',
    studentName: [student.lastName, student.firstName].filter(Boolean).join(', ') || student.displayName || 'Estudiante',
    studentCode: publicStudentCode(student.code),
    resultAccessCode: attemptData?.resultAccessCode || null,
    teacherName: exam.teacherName || '—',
    attemptNumber: attempt.number || 1,
    startedAt: attempt.startedAt,
    endedAt: attempt.submittedAt || attempt.deadlineAt,
    elapsedSeconds: elapsedSeconds(attempt.startedAt, attempt.submittedAt || attempt.deadlineAt),
    status: attempt.status,
    submissionReason: attempt.submissionReason,
    securityIncidents: Number(grading.securityIncidents || 0),
    rawScore: grading.rawScore,
    maxRawScore: grading.maxRawScore,
    pendingManualReviews,
    gradePending: pendingManualReviews > 0,
    gradeAvailable,
    correctnessVisible: questions.some((row) => typeof row.isCorrect === 'boolean'),
    ...grades,
    questions,
    counts,
    scale,
    cap,
  }
}

async function canvasToJpeg(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error('No se pudo rasterizar el PDF.')), 'image/jpeg', 0.93))
  return new Uint8Array(await blob.arrayBuffer())
}

function ascii(value) { return new TextEncoder().encode(value) }
function concatBytes(parts) {
  const length = parts.reduce((sum, part) => sum + part.length, 0)
  const output = new Uint8Array(length)
  let offset = 0
  parts.forEach((part) => { output.set(part, offset); offset += part.length })
  return output
}

function buildPdfFromJpegs(images) {
  const objectCount = 2 + images.length * 3
  const pageIds = images.map((_, index) => 3 + index * 3 + 2)
  const objects = new Array(objectCount + 1)
  objects[1] = ascii('<< /Type /Catalog /Pages 2 0 R >>')
  objects[2] = ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`)
  images.forEach((image, index) => {
    const imageId = 3 + index * 3
    const contentId = imageId + 1
    const pageId = imageId + 2
    objects[imageId] = concatBytes([
      ascii(`<< /Type /XObject /Subtype /Image /Width ${PAGE.width} /Height ${PAGE.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length} >>\nstream\n`),
      image,
      ascii('\nendstream'),
    ])
    const stream = 'q\n595 0 0 842 0 0 cm\n/Im0 Do\nQ'
    objects[contentId] = ascii(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    objects[pageId] = ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`)
  })

  const parts = [ascii('%PDF-1.4\n%DI\n')]
  const offsets = new Array(objectCount + 1).fill(0)
  let cursor = parts[0].length
  for (let id = 1; id <= objectCount; id += 1) {
    offsets[id] = cursor
    const chunk = concatBytes([ascii(`${id} 0 obj\n`), objects[id], ascii('\nendobj\n')])
    parts.push(chunk)
    cursor += chunk.length
  }
  const xrefOffset = cursor
  let xref = `xref\n0 ${objectCount + 1}\n0000000000 65535 f \n`
  for (let id = 1; id <= objectCount; id += 1) xref += `${String(offsets[id]).padStart(10, '0')} 00000 n \n`
  xref += `trailer\n<< /Size ${objectCount + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`
  parts.push(ascii(xref))
  return new Blob(parts, { type: 'application/pdf' })
}

async function buildReportBlob(report) {
  if (typeof document === 'undefined') throw new Error('La generación PDF requiere un navegador.')
  const painter = new ReportPainter(await loadReportLogos())
  painter.newPage({ first: true })
  painter.titleBanner(report.examTitle)
  painter.sectionBar('DATOS DEL ESTUDIANTE')
  const end = report.endedAt
  const elapsed = elapsedSeconds(report.startedAt, end, report.elapsedSeconds)
  painter.dataTable([
    ['Estudiante', report.studentName, 'Periodo académico', report.academicPeriod],
    [report.resultAccessCode ? 'Código personal de resultados' : 'Código universitario', report.resultAccessCode || report.studentCode, 'Fecha de evaluación', dateOnly(report.startedAt || end)],
    ['Curso', report.course, 'Hora de inicio', timeOnly(report.startedAt)],
    ['Sección', report.courseSection, 'Hora de finalización', timeOnly(end)],
    ['Docente', report.teacherName, 'Duración utilizada', elapsedLabel(elapsed)],
    ['', '', 'N.º de intento', report.attemptNumber],
  ])
  painter.resultAccessNotice(report.resultAccessCode)

  painter.resultSummary({
    finalGrade: report.finalGrade,
    calculatedGrade: report.calculated,
    percent: report.percent,
    answered: report.counts.answered,
    totalQuestions: report.counts.total,
    correct: report.counts.correct,
    incorrect: report.counts.incorrect,
    omitted: report.counts.omitted,
    status: statusLabel(report.status, report.submissionReason),
    securityIncidents: report.securityIncidents,
    rawScore: report.rawScore,
    maxRawScore: report.maxRawScore,
    pendingManualReviews: report.pendingManualReviews,
    gradePending: report.gradePending,
    gradeAvailable: report.gradeAvailable,
    correctnessVisible: report.correctnessVisible,
    cap: report.cap,
    scale: report.scale,
  })

  painter.sectionBar('DESARROLLO DE LA EVALUACIÓN')
  if (!report.questions.length) {
    roundRect(painter.ctx, 28, painter.y, PAGE.width - 56, 90, 8, COLORS.lightGray, COLORS.line)
    painter.ctx.fillStyle = COLORS.text
    painter.ctx.font = font(18, 400)
    painter.ctx.fillText('El intento fue registrado correctamente. El detalle de preguntas no está disponible para este reporte.', 48, painter.y + 30)
    painter.y += 110
  } else {
    report.questions.forEach((question) => painter.questionCard(question, { examTitle: report.examTitle, studentName: report.studentName }))
  }

  painter.addFooters()
  const jpegs = []
  for (const canvas of painter.pages) jpegs.push(await canvasToJpeg(canvas))
  return buildPdfFromJpegs(jpegs)
}

export async function buildTeacherAttemptPdfBlob({ exam, student, details, teacherName }) {
  return buildReportBlob(normalizeTeacherReport({ exam, student, details, teacherName }))
}

export async function buildStudentAttemptPdfBlob(attemptData) {
  return buildReportBlob(normalizeStudentReport(attemptData))
}

export async function downloadStudentAttemptPdf(attemptData) {
  const report = normalizeStudentReport(attemptData)
  const blob = await buildReportBlob(report)
  const filename = `Examen_${safePdfFilename(report.studentName)}_${safePdfFilename(report.examTitle)}.pdf`
  downloadBlob(blob, filename)
  return filename
}

export async function downloadTeacherAttemptPdf({ exam, student, details, teacherName }) {
  const report = normalizeTeacherReport({ exam, student, details, teacherName })
  const blob = await buildReportBlob(report)
  const filename = `Examen_${safePdfFilename(report.studentName)}_intento_${report.attemptNumber}.pdf`
  downloadBlob(blob, filename)
  return filename
}

export async function downloadAllTeacherAttemptPdfsZip({ exam, students, details, teacherName, onProgress }) {
  const closed = (students || []).filter((student) => ['submitted', 'time_expired'].includes(student?.status))
  if (!closed.length) throw new Error('No existen exámenes finalizados para incluir en el ZIP.')

  const zip = new JSZip()
  const folder = zip.folder('Examenes_individuales')
  for (let index = 0; index < closed.length; index += 1) {
    const student = closed[index]
    const report = normalizeTeacherReport({ exam, student, details, teacherName })
    onProgress?.({ current: index + 1, total: closed.length, student: report.studentName })
    const blob = await buildReportBlob(report)
    const bytes = new Uint8Array(await blob.arrayBuffer())
    const filename = `${String(index + 1).padStart(2, '0')}_${safePdfFilename(report.studentName)}_Intento_${report.attemptNumber}.pdf`
    folder.file(filename, bytes)
  }

  const excluded = (students || []).filter((student) => !['submitted', 'time_expired'].includes(student?.status))
  const indexText = [
    `Examen: ${exam?.title || 'Evaluación'}`,
    `Curso: ${exam?.cursos?.name || '—'}`,
    `PDF incluidos: ${closed.length}`,
    `Intentos no finalizados excluidos: ${excluded.length}`,
    `Generado: ${dateTime(new Date())}`,
  ].join('\r\n')
  zip.file('INDICE_DE_EVIDENCIAS.txt', indexText)

  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } })
  const filename = `Examenes_${safePdfFilename(exam?.title || 'Evaluacion')}.zip`
  downloadBlob(blob, filename)
  return { filename, included: closed.length, excluded: excluded.length }
}
