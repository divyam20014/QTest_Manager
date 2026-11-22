import { MoreHorizontal } from 'lucide-react'

import { DropdownMenu, type DropdownMenuItem } from '@/components/ui/dropdown-menu'
import { IconButton } from '@/components/ui/icon-button'

/**
 * The "..." menu in a list page's header: where the secondary actions
 * (Import, Export, Templates ...) live so the header keeps exactly one
 * primary button.
 */
export function MoreActionsMenu({
  items,
  label = 'More actions',
}: {
  items: DropdownMenuItem[]
  label?: string
}) {
  return (
    <DropdownMenu
      label={label}
      items={items}
      trigger={(props) => (
        <IconButton variant="secondary" aria-label={label} {...props}>
          <MoreHorizontal aria-hidden="true" />
        </IconButton>
      )}
    />
  )
}
