import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { createTeam, deleteTeam, listTeams, updateTeam, type Team, type TeamRequest } from '@/api/teams'
import { listUsers, type User } from '@/api/users'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { useToast } from '@/lib/toast'

// ADR-141: named groups of users, to add to a project in one step.
export function Teams() {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()
  const teams = useQuery({ queryKey: ['teams'], queryFn: listTeams })
  // null = closed, 'new' = creating, otherwise the team being edited.
  const [editing, setEditing] = useState<Team | 'new' | null>(null)

  const remove = useMutation({
    mutationFn: (id: string) => deleteTeam(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      showToast('success', 'Team deleted')
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not delete the team'),
  })

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="Teams"
        description="Groups of people you can add to a project in one step. A team gives no access by itself."
        actions={<Button onClick={() => setEditing('new')}>New team</Button>}
      />
      {confirmDialog}
      {teams.isLoading ? (
        <DetailSkeleton />
      ) : teams.isError ? (
        <ErrorState message="Could not load teams." error={teams.error} onRetry={() => teams.refetch()} />
      ) : teams.data?.length === 0 ? (
        <EmptyState title="No teams yet" description="Create a team, then add it from a project's Team tab." />
      ) : (
        <ul className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {teams.data?.map((team) => (
            <li key={team.id}>
              <Card className="h-full">
                <CardHeader>
                  <CardTitle>{team.name}</CardTitle>
                </CardHeader>
                <CardContent className="flex flex-col gap-3 text-sm">
                  <p className="text-[var(--muted-foreground)]">
                    Lead: {team.lead_name ?? 'none'} · {team.members.length} member{team.members.length === 1 ? '' : 's'}
                  </p>
                  <p>
                    {team.members.length === 0
                      ? 'Nobody is in this team yet.'
                      : team.members.map((m) => (m.is_active ? m.name : `${m.name} (inactive)`)).join(', ')}
                  </p>
                  <div className="flex gap-2">
                    <Button variant="outline" size="sm" aria-label={`Edit team ${team.name}`} onClick={() => setEditing(team)}>
                      Edit
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      aria-label={`Delete team ${team.name}`}
                      onClick={() =>
                        ask({
                          title: `Delete team “${team.name}”?`,
                          description: 'Nobody loses access: people already added to projects stay on them.',
                          confirmLabel: 'Delete team',
                          run: () => remove.mutateAsync(team.id),
                        })
                      }
                    >
                      Delete
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <Dialog
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing === 'new' ? 'New team' : 'Edit team'}
        className="max-w-lg"
      >
        {editing !== null && (
          <TeamForm key={editing === 'new' ? 'new' : editing.id} team={editing === 'new' ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Dialog>
    </div>
  )
}

export function TeamForm({ team, onDone }: { team: Team | null; onDone: () => void }) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const users = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const [name, setName] = useState(team?.name ?? '')
  const [lead, setLead] = useState(team?.lead_user_id ?? '')
  const [members, setMembers] = useState<Set<string>>(() => new Set(team?.members.map((m) => m.user_id)))
  const [search, setSearch] = useState('')

  const save = useMutation({
    mutationFn: () => {
      const req: TeamRequest = { name: name.trim(), lead_user_id: lead || null, member_ids: [...members] }
      return team ? updateTeam(team.id, req) : createTeam(req)
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['teams'] })
      showToast('success', team ? 'Team saved' : 'Team created')
      onDone()
    },
  })

  // Active people, plus anyone already chosen, so an inactive member can be seen and removed.
  const choosable: User[] = (users.data ?? []).filter((u) => u.is_active || members.has(u.id) || u.id === lead)
  const shown = choosable.filter((u) => u.name.toLowerCase().includes(search.trim().toLowerCase()))

  function toggle(id: string) {
    setMembers((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <form
      className="flex flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        save.mutate()
      }}
    >
      <FormField id="team-name" label="Team name" required>
        {(f) => <Input {...f} value={name} maxLength={80} autoComplete="off" onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="team-lead" label="Lead (optional)">
        {(f) => (
          <Select {...f} value={lead} onChange={(e) => setLead(e.target.value)}>
            <option value="">No lead</option>
            {choosable.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 font-medium">Members ({members.size} chosen)</legend>
        <Input aria-label="Search people" placeholder="Search people" value={search} onChange={(e) => setSearch(e.target.value)} />
        <ul className="max-h-56 overflow-y-auto rounded-md border border-[var(--border)] p-2">
          {shown.map((u) => (
            <li key={u.id}>
              <label className="flex items-center gap-2 py-1 max-md:min-h-11">
                <input type="checkbox" checked={members.has(u.id)} onChange={() => toggle(u.id)} />
                {u.name}
                {!u.is_active && <span className="text-[var(--muted-foreground)]">(inactive)</span>}
              </label>
            </li>
          ))}
          {shown.length === 0 && <li className="py-1 text-[var(--muted-foreground)]">No people match.</li>}
        </ul>
      </fieldset>
      <FormError>{save.error instanceof ApiError ? save.error.message : null}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" size="sm" onClick={onDone}>
          Cancel
        </Button>
        <Button type="submit" size="sm" loading={save.isPending} disabled={name.trim().length < 2}>
          {team ? 'Save team' : 'Create team'}
        </Button>
      </DialogFooter>
    </form>
  )
}
