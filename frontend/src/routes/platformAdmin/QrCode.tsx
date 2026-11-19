import { useMemo } from 'react'
import { encode } from 'uqr'

/** Renders `value` as a QR code, client-side (nothing is sent anywhere).
 * Always dark-on-white with a 4-module quiet zone -- scanners need that
 * contrast, so it deliberately ignores the light/dark theme. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const { size, path } = useMemo(() => {
    const result = encode(value, { ecc: 'M', border: 0 })
    const rows: string[] = []
    result.data.forEach((row, y) => {
      let x = 0
      while (x < row.length) {
        if (!row[x]) {
          x += 1
          continue
        }
        let end = x
        while (end < row.length && row[end]) end += 1
        rows.push(`M${x} ${y}h${end - x}v1h-${end - x}z`)
        x = end
      }
    })
    return { size: result.size, path: rows.join('') }
  }, [value])

  const quiet = 4
  const total = size + quiet * 2
  return (
    <svg
      role="img"
      aria-label={label}
      viewBox={`0 0 ${total} ${total}`}
      className="h-48 w-48 shrink-0 rounded-md border border-[var(--border)] bg-white"
      shapeRendering="crispEdges"
    >
      <rect width={total} height={total} fill="#ffffff" />
      <path transform={`translate(${quiet} ${quiet})`} d={path} fill="#000000" />
    </svg>
  )
}
