import { hasPermission, isManagerOrAbove } from '@/api/auth'
import { useAuth } from '@/lib/auth'

/** Permissions of the signed-in user for the defect actions (the API stays the authority). */
export function useDefectPermissions() {
  const { user } = useAuth()
  const canClose = hasPermission(user, 'defect.close') || isManagerOrAbove(user)
  return {
    canCreate: hasPermission(user, 'defect.create'),
    canEdit: hasPermission(user, 'defect.edit') || hasPermission(user, 'defect.create'),
    canAssign: hasPermission(user, 'defect.assign') || hasPermission(user, 'defect.close'),
    canChangeStatus:
      hasPermission(user, 'defect.change_status') || hasPermission(user, 'defect.create') || hasPermission(user, 'defect.close'),
    canClose,
    canDelete: hasPermission(user, 'defect.delete'),
    canExport: hasPermission(user, 'defect.export'),
    canImport: hasPermission(user, 'defect.import') || hasPermission(user, 'defect.create'),
  }
}
