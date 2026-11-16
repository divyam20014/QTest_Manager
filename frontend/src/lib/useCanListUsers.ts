import { hasPermission } from '@/api/auth'
import { useAuth } from '@/lib/auth'

/** Whether the API will answer `GET /users` for this session. It requires
 * `user.manage` or `project.members.manage`; for any other role the call is a
 * guaranteed 403 (and react-query would retry it three times), so screens that
 * only use the list to resolve names skip the request. Mirrors the backend
 * check, it does not replace it. */
export function useCanListUsers(): boolean {
  const { user } = useAuth()
  return hasPermission(user, 'user.manage') || hasPermission(user, 'project.members.manage')
}
