import type { TestCaseFieldCatalog } from '@/api/testCases'
import { ColumnModeMenu } from '@/components/table/ColumnModeMenu'
import type { TableDensity } from '@/components/table/tablePrefs'
import { pickerColumns, type ColumnMode } from '@/lib/testCaseColumns'

/**
 * Column picker of the Test Case list: three modes (Default 9 / All Fields 22 / Custom), a checklist
 * built from GET /test-cases/columns, and the shared row-density toggle (the generic ColumnModeMenu).
 */
export function TestCaseColumnMenu({
  catalog,
  keys,
  mode,
  onMode,
  onToggle,
  density,
  setDensity,
}: {
  catalog: TestCaseFieldCatalog | undefined
  keys: string[]
  mode: ColumnMode
  onMode: (mode: ColumnMode) => void
  onToggle: (key: string) => void
  density?: TableDensity
  setDensity?: (density: TableDensity) => void
}) {
  return (
    <ColumnModeMenu
      columns={pickerColumns(catalog)}
      keys={keys}
      mode={mode}
      onMode={onMode}
      onToggle={onToggle}
      density={density}
      setDensity={setDensity}
      idPrefix="tc"
      modeHelp={{
        default: 'The nine standard columns.',
        all: `All ${catalog?.fields.length ?? 22} fields of the test case standard.`,
        custom: 'Tick the columns you want. Save a view to keep this set.',
      }}
    />
  )
}
