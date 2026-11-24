import { SegmentedToggle } from '@/components/ui/segmented'
import { VIEW_MODE_LABEL, type ViewMode } from '@/lib/viewMode'

/**
 * List | Board | Calendar, one control for every list that offers more than a table (ADR-124).
 * A pressed-button group like the other one-click list switches: it changes how the same records
 * are laid out in place and has no panel of its own. Only the modes the list really supports are given.
 */
export function ViewSwitcher({
  modes,
  value,
  onChange,
}: {
  modes: readonly ViewMode[]
  value: ViewMode
  onChange: (mode: ViewMode) => void
}) {
  return (
    <SegmentedToggle
      label="View"
      value={value}
      onChange={onChange}
      options={modes.map((m) => ({ value: m, label: VIEW_MODE_LABEL[m] }))}
    />
  )
}
