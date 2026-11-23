import { Bug, Building2, ClipboardList, FileStack, FileText } from 'lucide-react'
import type { ComponentType } from 'react'

import type { PinType } from '@/lib/pinnedItems'

/** The icon for each kind of favourite / recent record. */
export const PIN_ICON: Record<PinType, ComponentType<{ className?: string }>> = {
  project: Building2,
  test_case: FileStack,
  defect: Bug,
  test_run: ClipboardList,
  requirement: FileText,
}
