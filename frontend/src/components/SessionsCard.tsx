import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { fetchSessions, revokeSession, type SessionInfo } from '@/api/auth'
import { ApiError } from '@/api/client'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog } from '@/components/ui/dialog'
import { useToast } from '@/lib/toast'

export function SessionsCard() {
  const { show: showToast } = useToast()
  const queryClient = useQueryClient()
  const [revokeTarget, setRevokeTarget] = useState<SessionInfo | null>(null)

  const sessionsQuery = useQuery({ queryKey: ['auth', 'sessions'], queryFn: fetchSessions })

  const revokeMutation = useMutation({
    mutationFn: (sessionId: string) => revokeSession(sessionId),
    onSuccess: () => {
      showToast('success', 'Session revoked')
      setRevokeTarget(null)
      queryClient.invalidateQueries({ queryKey: ['auth', 'sessions'] })
    },
    onError: (error: unknown) => {
      showToast('error', error instanceof ApiError ? error.message : 'Could not revoke that session')
    },
  })

  const sessions = sessionsQuery.data?.sessions ?? []

  return (
    <Card>
      <CardHeader>
        <CardTitle>Active Sessions</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="mb-3 text-xs text-[var(--muted-foreground)]">
          Devices and browsers currently signed in to your account. Revoke any session you don't
          recognize.
        </p>
        <ul className="flex flex-col gap-2 text-sm">
          {sessions.length === 0 && (
            <li className="text-[var(--muted-foreground)]">No active sessions.</li>
          )}
          {sessions.map((s) => (
            <li
              key={s.id}
              className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0"
            >
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  {s.is_current && <Badge>Current session</Badge>}
                  <span className="text-xs text-[var(--muted-foreground)]">
                    Signed in {new Date(s.created_at).toLocaleString()}
                  </span>
                </div>
                <span className="text-xs text-[var(--muted-foreground)]">
                  Last active {new Date(s.last_seen_at).toLocaleString()} · Expires{' '}
                  {new Date(s.expires_at).toLocaleString()}
                </span>
              </div>
              {!s.is_current && (
                <Button variant="ghost" size="sm" onClick={() => setRevokeTarget(s)}>
                  Revoke
                </Button>
              )}
            </li>
          ))}
        </ul>
      </CardContent>

      <Dialog
        open={!!revokeTarget}
        onClose={() => setRevokeTarget(null)}
        title="Revoke session"
      >
        <div className="flex flex-col gap-4 text-sm">
          <p className="text-[var(--muted-foreground)]">
            Revoke this session? The device will be signed out immediately and will need to log
            in again. This cannot be undone.
          </p>
          <div className="flex justify-end gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setRevokeTarget(null)}
              disabled={revokeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              size="sm"
              disabled={revokeMutation.isPending}
              onClick={() => revokeTarget && revokeMutation.mutate(revokeTarget.id)}
            >
              {revokeMutation.isPending ? 'Revoking…' : 'Revoke'}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  )
}
