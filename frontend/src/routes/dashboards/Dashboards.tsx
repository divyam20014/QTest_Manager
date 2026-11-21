import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Pencil, Plus, Star, Trash2 } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { ApiError } from '@/api/client'
import {
  MAX_DASHBOARDS,
  createDashboard,
  deleteDashboard,
  listDashboards,
  renameDashboard,
  setTeamDefault,
  type DashboardSummaryItem,
} from '@/api/dashboards'
import { hasPermission } from '@/api/auth'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { Input } from '@/components/ui/input'
import { PageHeader } from '@/components/ui/PageHeader'
import { StatusBadge } from '@/components/ui/StatusBadge'
import { Skeleton } from '@/components/ui/skeleton'
import { useConfirm } from '@/components/ui/useConfirm'
import { useAuth } from '@/lib/auth'
import { useToast } from '@/lib/toast'

function errMessage(e: unknown): string {
  return e instanceof ApiError ? e.message : 'Something went wrong'
}

type NameDialog = { mode: 'create' } | { mode: 'rename'; item: DashboardSummaryItem } | null

export function Dashboards() {
  const { user } = useAuth()
  const userId = user?.user_id ?? 'anon'
  const isAdmin = hasPermission(user, 'tenant.settings.manage')
  const qc = useQueryClient()
  const navigate = useNavigate()
  const { show } = useToast()
  const { ask, dialog } = useConfirm()
  const [nameDialog, setNameDialog] = useState<NameDialog>(null)
  const [name, setName] = useState('')

  const key = ['dashboards', 'list', userId]
  const list = useQuery({ queryKey: key, queryFn: listDashboards, retry: 1 })
  const refresh = () => qc.invalidateQueries({ queryKey: ['dashboards'] })
  const items = list.data ?? []
  const own = items.filter((d) => !d.is_team_default)
  const team = items.find((d) => d.is_team_default)

  const create = useMutation({
    mutationFn: (n: string) => createDashboard(n),
    onSuccess: (d) => {
      void refresh()
      navigate(`/dashboards/${d.id}`)
    },
    onError: (e) => show('error', errMessage(e)),
  })
  const rename = useMutation({
    mutationFn: (p: { id: string; name: string }) => renameDashboard(p.id, p.name),
    onSuccess: () => {
      void refresh()
      setNameDialog(null)
      show('success', 'Dashboard renamed')
    },
    onError: (e) => show('error', errMessage(e)),
  })
  const remove = useMutation({
    mutationFn: (id: string) => deleteDashboard(id),
    onSuccess: () => {
      void refresh()
      show('success', 'Dashboard deleted')
    },
    onError: (e) => show('error', errMessage(e)),
  })
  const teamDefault = useMutation({
    mutationFn: (p: { id: string; enabled: boolean }) => setTeamDefault(p.id, p.enabled),
    onSuccess: (_d, vars) => {
      void refresh()
      show('success', vars.enabled ? 'Team default dashboard set' : 'Team default removed')
    },
    onError: (e) => show('error', errMessage(e)),
  })

  function openDialog(next: NameDialog) {
    setName(next?.mode === 'rename' ? next.item.name : '')
    setNameDialog(next)
  }

  function submit(e: FormEvent) {
    e.preventDefault()
    const trimmed = name.trim()
    if (!trimmed || !nameDialog) return
    if (nameDialog.mode === 'create') create.mutate(trimmed)
    else rename.mutate({ id: nameDialog.item.id, name: trimmed })
  }

  function card(d: DashboardSummaryItem) {
    return (
      <li key={d.id}>
        <EmbossedCard className="flex flex-col gap-3 p-4">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Link
              to={`/dashboards/${d.id}`}
              className="min-w-0 break-words text-base font-medium underline-offset-2 hover:underline max-md:min-h-11 max-md:py-2"
            >
              {d.name}
            </Link>
            {d.is_team_default && <StatusBadge tone="info">Team default</StatusBadge>}
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            {d.widget_count} {d.widget_count === 1 ? 'widget' : 'widgets'}
          </p>
          <div className="flex flex-wrap gap-2">
            {d.can_edit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Rename ${d.name}`}
                onClick={() => openDialog({ mode: 'rename', item: d })}
              >
                <Pencil className="mr-1 size-4" aria-hidden="true" /> Rename
              </Button>
            )}
            {isAdmin && !d.is_team_default && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Set ${d.name} as team default`}
                disabled={teamDefault.isPending}
                onClick={() => teamDefault.mutate({ id: d.id, enabled: true })}
              >
                <Star className="mr-1 size-4" aria-hidden="true" /> Set as team default
              </Button>
            )}
            {isAdmin && d.is_team_default && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Remove team default ${d.name}`}
                disabled={teamDefault.isPending}
                onClick={() => teamDefault.mutate({ id: d.id, enabled: false })}
              >
                Remove team default
              </Button>
            )}
            {d.can_edit && (
              <Button
                type="button"
                variant="outline"
                size="sm"
                aria-label={`Delete ${d.name}`}
                onClick={() =>
                  ask({
                    title: 'Delete this dashboard?',
                    description: `"${d.name}" and its widget layout will be removed. This cannot be undone.`,
                    run: () => remove.mutateAsync(d.id),
                  })
                }
              >
                <Trash2 className="mr-1 size-4" aria-hidden="true" /> Delete
              </Button>
            )}
          </div>
        </EmbossedCard>
      </li>
    )
  }

  const atLimit = own.length >= MAX_DASHBOARDS

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        back={
          <Link to="/" className="text-xs text-[var(--link)] hover:underline">
            &larr; Dashboard
          </Link>
        }
        title="Manage dashboards"
        description="Build your own dashboards from a fixed set of widgets. They are private to you."
        actions={
          <Button type="button" disabled={atLimit} onClick={() => openDialog({ mode: 'create' })}>
            <Plus className="mr-1 size-4" aria-hidden="true" /> New dashboard
          </Button>
        }
      />
      {atLimit && (
        <p className="text-sm text-[var(--muted-foreground)]">
          You have reached the limit of {MAX_DASHBOARDS} dashboards. Delete one to create another.
        </p>
      )}
      {list.isPending ? (
        <Skeleton className="h-24 w-full" />
      ) : list.isError ? (
        <ErrorState error={list.error} onRetry={() => void list.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState
          title="No dashboards yet"
          description="Create one, then add widgets such as summary tiles, trends and saved reports."
        />
      ) : (
        <>
          {team && (
            <section aria-labelledby="team-dash-h" className="flex flex-col gap-2">
              <h2 id="team-dash-h" className="qth-type-section-title">
                Team default
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{card(team)}</ul>
            </section>
          )}
          {own.length > 0 && (
            <section aria-labelledby="own-dash-h" className="flex flex-col gap-2">
              <h2 id="own-dash-h" className="qth-type-section-title">
                My dashboards
              </h2>
              <ul className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">{own.map(card)}</ul>
            </section>
          )}
        </>
      )}
      <Dialog
        open={nameDialog !== null}
        onClose={() => setNameDialog(null)}
        title={nameDialog?.mode === 'rename' ? 'Rename dashboard' : 'New dashboard'}
      >
        <form onSubmit={submit} className="flex flex-col gap-3">
          <label htmlFor="dash-name" className="text-sm font-medium">
            Dashboard name
          </label>
          <Input id="dash-name" value={name} maxLength={60} autoFocus onChange={(e) => setName(e.target.value)} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setNameDialog(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={create.isPending || rename.isPending}
              disabled={!name.trim()}>
              {nameDialog?.mode === 'rename' ? 'Save name' : 'Create dashboard'}
            </Button>
          </div>
        </form>
      </Dialog>
      {dialog}
    </div>
  )
}
