// Helpers behind the chart card's "..." menu: CSV from the data already on
// screen, and PNG by serialising the chart's SVG onto a canvas.

/** Cells that start with one of these are read as formulas by spreadsheets. */
const FORMULA_START = /^[=+\-@\t\r]/

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return String(value)
  // Prefix text that a spreadsheet would execute (CSV injection); real numbers stay as they are.
  const text = FORMULA_START.test(value) && Number.isNaN(Number(value)) ? `'${value}` : value
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

/** RFC 4180 CSV: fields with a comma, quote or line break are quoted, quotes doubled; CRLF rows. */
export function toCsv(columns: string[], rows: (string | number | null | undefined)[][]): string {
  return [columns, ...rows].map((row) => row.map(csvCell).join(',')).join('\r\n')
}

/** "Execution Trends (last 30 days)" + 2026-11-22 -> "execution-trends-last-30-days-2026-11-22". */
export function chartFilename(title: string, date: Date = new Date()): string {
  const slug =
    title
      .toLowerCase()
      .replace(/&/g, ' and ')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'chart'
  return `${slug}-${date.toISOString().slice(0, 10)}`
}

export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  setTimeout(() => URL.revokeObjectURL(url), 0)
}

export function downloadCsv(columns: string[], rows: (string | number | null | undefined)[][], title: string): void {
  // BOM so Excel reads UTF-8 correctly.
  saveBlob(new Blob(['﻿', toCsv(columns, rows)], { type: 'text/csv;charset=utf-8' }), `${chartFilename(title)}.csv`)
}

const PAINT_ATTRS = ['fill', 'stroke', 'stop-color', 'color']

/** A standalone copy of the SVG with CSS variables resolved, since a serialised SVG has no page styles. */
function inlineSvg(svg: SVGSVGElement): { clone: SVGSVGElement; width: number; height: number } {
  const rect = svg.getBoundingClientRect()
  const width = Math.max(1, Math.round(rect.width))
  const height = Math.max(1, Math.round(rect.height))
  const clone = svg.cloneNode(true) as SVGSVGElement
  const src = [svg, ...Array.from(svg.querySelectorAll('*'))]
  const dst = [clone, ...Array.from(clone.querySelectorAll('*'))]
  src.forEach((el, i) => {
    const target = dst[i] as SVGElement
    const computed = getComputedStyle(el)
    for (const attr of PAINT_ATTRS) {
      const value = target.getAttribute(attr)
      if (value && value.includes('var(')) target.setAttribute(attr, computed.getPropertyValue(attr) || 'none')
    }
    if (el.tagName.toLowerCase() === 'text' || el.tagName.toLowerCase() === 'tspan') {
      target.setAttribute('font-family', computed.fontFamily)
      target.removeAttribute('style')
    } else {
      target.removeAttribute('style')
    }
  })
  clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg')
  clone.setAttribute('width', String(width))
  clone.setAttribute('height', String(height))
  return { clone, width, height }
}

/** Renders a Recharts SVG to a PNG (2x for sharpness) on the page's own background colour. */
export async function svgToPngBlob(svg: SVGSVGElement, background: string): Promise<Blob> {
  const { clone, width, height } = inlineSvg(svg)
  const scale = 2
  const markup = new XMLSerializer().serializeToString(clone)
  const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml;charset=utf-8' }))
  try {
    const image = new Image()
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve()
      image.onerror = () => reject(new Error('Could not render the chart'))
      image.src = url
    })
    const canvas = document.createElement('canvas')
    canvas.width = width * scale
    canvas.height = height * scale
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('Canvas is not available')
    ctx.fillStyle = background
    ctx.fillRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height)
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image'))), 'image/png'),
    )
  } finally {
    URL.revokeObjectURL(url)
  }
}
