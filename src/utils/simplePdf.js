const A4 = { width: 595, height: 842 }
const MARGIN = 46

function normalizeText(value) {
  return String(value ?? '')
    .replace(/[–—]/g, '-')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/•/g, '-')
    .replace(/…/g, '...')
    .replace(/≥/g, '>=')
    .replace(/≤/g, '<=')
    .replace(/→/g, '->')
}

const winAnsi = new Map([
  ['á', 0xe1], ['é', 0xe9], ['í', 0xed], ['ó', 0xf3], ['ú', 0xfa], ['Á', 0xc1], ['É', 0xc9], ['Í', 0xcd], ['Ó', 0xd3], ['Ú', 0xda],
  ['ñ', 0xf1], ['Ñ', 0xd1], ['ü', 0xfc], ['Ü', 0xdc], ['¿', 0xbf], ['¡', 0xa1], ['°', 0xb0], ['º', 0xba], ['ª', 0xaa], ['%', 0x25],
])

function pdfLiteral(value) {
  let output = ''
  for (const char of normalizeText(value)) {
    if (char === '\\' || char === '(' || char === ')') { output += `\\${char}`; continue }
    const code = char.charCodeAt(0)
    if (code >= 32 && code <= 126) { output += char; continue }
    const mapped = winAnsi.get(char)
    if (mapped != null) { output += `\\${mapped.toString(8).padStart(3, '0')}`; continue }
    output += '?'
  }
  return output
}

function wrap(text, maxChars) {
  const paragraphs = normalizeText(text).split(/\r?\n/)
  const lines = []
  for (const paragraph of paragraphs) {
    if (!paragraph.trim()) { lines.push(''); continue }
    const words = paragraph.trim().split(/\s+/)
    let current = ''
    for (const word of words) {
      const next = current ? `${current} ${word}` : word
      if (next.length <= maxChars) current = next
      else {
        if (current) lines.push(current)
        if (word.length <= maxChars) current = word
        else {
          for (let i = 0; i < word.length; i += maxChars) lines.push(word.slice(i, i + maxChars))
          current = ''
        }
      }
    }
    if (current) lines.push(current)
  }
  return lines
}

export function buildTextPdf({ title = 'Desafío Industrial', metadataLines = [], sections = [], footer = 'Desafío Industrial · Ingeniería Industrial UNSA' }) {
  const pages = [[]]
  let pageIndex = 0
  let y = A4.height - MARGIN
  const usableWidth = A4.width - MARGIN * 2

  const addLine = (text, options = {}) => {
    const size = Number(options.size || 10)
    const font = options.bold ? 'F2' : 'F1'
    const x = MARGIN + Number(options.indent || 0)
    const maxChars = Math.max(18, Math.floor((usableWidth - Number(options.indent || 0)) / (size * 0.52)))
    const lineHeight = Number(options.lineHeight || size * 1.35)
    for (const line of wrap(text, maxChars)) {
      if (y < MARGIN + 34) {
        pageIndex += 1
        pages.push([])
        y = A4.height - MARGIN
      }
      pages[pageIndex].push({ x, y, text: line, size, font })
      y -= lineHeight
    }
    y -= Number(options.after || 0)
  }

  addLine('DESAFÍO INDUSTRIAL', { bold: true, size: 17, after: 3 })
  addLine('Ingeniería Industrial UNSA', { size: 9, after: 12 })
  addLine(title, { bold: true, size: 15, after: 10 })
  metadataLines.forEach(([label, value]) => addLine(`${label}: ${value ?? '-'}`, { size: 9.5 }))
  y -= 10

  sections.forEach((section) => {
    if (section.heading) addLine(section.heading, { bold: true, size: 11.5, after: 4 })
    for (const item of section.lines || []) {
      if (typeof item === 'string') addLine(item, { size: 9.5, after: 2 })
      else addLine(item.text, { size: item.size || 9.5, bold: item.bold, indent: item.indent || 0, after: item.after ?? 2 })
    }
    y -= 5
  })

  // Add a footer on every page.
  pages.forEach((page, index) => page.push({ x: MARGIN, y: 24, text: `${footer} · Página ${index + 1} de ${pages.length}`, size: 7.5, font: 'F1' }))

  const objects = []
  const addObject = (body) => { objects.push(body); return objects.length }
  const catalogId = addObject('')
  const pagesId = addObject('')
  const fontRegularId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>')
  const fontBoldId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>')
  const pageIds = []

  for (const page of pages) {
    const stream = page.map((line) => `BT /${line.font} ${line.size.toFixed(2)} Tf 1 0 0 1 ${line.x.toFixed(2)} ${line.y.toFixed(2)} Tm (${pdfLiteral(line.text)}) Tj ET`).join('\n')
    const contentId = addObject(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
    const pageId = addObject(`<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${fontRegularId} 0 R /F2 ${fontBoldId} 0 R >> >> /Contents ${contentId} 0 R >>`)
    pageIds.push(pageId)
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`

  let pdf = '%PDF-1.4\n%----\n'
  const offsets = [0]
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(pdf.length)
    pdf += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`
  }
  const xref = pdf.length
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`
  for (let i = 1; i <= objects.length; i += 1) pdf += `${String(offsets[i]).padStart(10, '0')} 00000 n \n`
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xref}\n%%EOF`
  return new Blob([new TextEncoder().encode(pdf)], { type: 'application/pdf' })
}

export function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  anchor.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 2000)
}

export function safePdfFilename(value) {
  return normalizeText(value || 'examen')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 90) || 'examen'
}
