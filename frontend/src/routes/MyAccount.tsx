import { useQuery } from '@tanstack/react-query'

import { fetchOwnHistory } from '@/api/audit'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { SessionsCard } from '@/components/SessionsCard'
import { useAuth } from '@/lib/auth'

export function MyAccount() {
  const { user } = useAuth()
  const historyQuery = useQuery({ queryKey: ['users', 'me', 'history'], queryFn: fetchOwnHistory })

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-lg font-semibold">My Account</h1>

      <Card>
        <CardHeader>
          <CardTitle>Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-1 gap-2 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Name</dt>
              <dd>{user?.name}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Email</dt>
              <dd>{user?.email}</dd>
            </div>
            <div>
              <dt className="text-xs text-[var(--muted-foreground)]">Role</dt>
              <dd className="capitalize">{user?.role}</dd>
            </div>
          </dl>
        </CardContent>
      </Card>

      <SessionsCard />

      <Card>
        <CardHeader>
          <CardTitle>Account History</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-xs text-[var(--muted-foreground)]">
            Every change recorded against your account — profile edits, role changes, password resets.
          </p>
          <ul className="flex flex-col gap-2 text-sm">
            {historyQuery.data?.length === 0 && (
              <li className="text-[var(--muted-foreground)]">No account changes recorded yet.</li>
            )}
            {historyQuery.data?.map((entry) => (
              <li
                key={entry.id}
                className="flex items-center justify-between gap-4 border-b border-[var(--border)] pb-2 last:border-0"
              >
                <Badge>{entry.action}</Badge>
                <span className="shrink-0 text-xs text-[var(--muted-foreground)]">
                  {new Date(entry.created_at).toLocaleString()}
                </span>
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>
    </div>
  )
}
