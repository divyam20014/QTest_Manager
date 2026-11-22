import { FileImage, FileSpreadsheet, MoreHorizontal } from 'lucide-react'

import { IconButton } from '@/components/ui/icon-button'
import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { chartFilename, downloadCsv, saveBlob, svgToPngBlob } from '@/lib/chartExport'
import { useToast } from '@/lib/toast'
import type { ChartTable } from '@/components/ui/ChartPanel'

/**
 * The "..." menu on a chart card: "Download CSV" (the data already loaded, the
 * same rows as the table view) and "Download PNG" (the chart's SVG drawn onto a
 * canvas). PNG is offered only for SVG charts in chart view (`png`); if the
 * card is showing a loading / empty state a toast explains there is no chart yet.
 * The HTML legend is not part of the image.
 */
export function ChartActions({
  title,
  table,
  png,
  getSvg,
}: {
  title: string
  table?: ChartTable
  /** Include the PNG item (SVG charts in chart view only). */
  png: boolean
  getSvg: () => SVGSVGElement | null
}) {
  const { show } = useToast()

  async function downloadPng() {
    const svg = getSvg()
    if (!svg) {
      show('error', 'Switch to the chart view to download it as an image.')
      return
    }
    try {
      const blob = await svgToPngBlob(svg, getComputedStyle(document.body).backgroundColor || 'Canvas')
      saveBlob(blob, `${chartFilename(title)}.png`)
      show('success', 'Chart image downloaded')
    } catch {
      show('error', 'Could not create the chart image. Please try again.')
    }
  }

  const items: DropdownMenuItem[] = [
    {
      label: 'Download CSV',
      icon: <FileSpreadsheet className="size-4" aria-hidden="true" />,
      disabled: !table,
      onSelect: () => {
        if (!table) return
        downloadCsv(table.columns, table.rows, title)
        show('success', 'CSV downloaded')
      },
    },
    ...(png
      ? [
          {
            label: 'Download PNG',
            icon: <FileImage className="size-4" aria-hidden="true" />,
            onSelect: () => void downloadPng(),
          },
        ]
      : []),
  ]

  return (
    <DropdownMenu
      label={`${title} actions`}
      items={items}
      trigger={(props) => (
        <IconButton {...props} aria-label="Chart actions" size="sm">
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      )}
    />
  )
}
