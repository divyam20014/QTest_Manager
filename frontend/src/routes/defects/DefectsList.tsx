import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createDefect, listDefects, type DefectStatus, type Severity } from '@/api/defects'
import { listFieldOptions } from '@/api/fieldCustomization'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { STATUS_ORDER, STATUS_TONE, severityTone } from './statusDisplay'

export function DefectsList() {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState<DefectStatus | ''>('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [reportedBy, setReportedBy] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-filter'],
    queryFn: () => listProjects({ page_size: 100, sort: 'name' }),
  })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })
  const defectsQuery = useQuery({
    queryKey: ['defects', projectId, status, severity, reportedBy, createdFrom, createdTo],
    queryFn: () =>
      listDefects({
        project_id: projectId || undefined,
        status: status || undefined,
        severity: severity || undefined,
        reported_by: reportedBy || undefined,
        created_from: createdFrom ? new Date(createdFrom).toISOString() : undefined,
        created_to: createdTo ? new Date(createdTo + 'T23:59:59').toISOString() : undefined,
      }),
  })

  // defect.create is granted to every role (admin/manager/tester) per
  // ADR-014's seed, so this is a contextual action available uniformly --
  // not role-gated, matching the backend permission it calls.
  const canCreate = !!user

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Defects</h1>
        {canCreate && <Button onClick={() => setCreateOpen(true)}>New Defect</Button>}
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <Select
          aria-label="Filter by project"
          value={projectId}
          onChange={(e) => setProjectId(e.target.value)}
          className="w-56"
        >
          <option value="">All Projects</option>
          {projectsQuery.data?.items.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by status"
          value={status}
          onChange={(e) => setStatus(e.target.value as DefectStatus | '')}
          className="w-40"
        >
          <option value="">All Statuses</option>
          {STATUS_ORDER.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by severity"
          value={severity}
          onChange={(e) => setSeverity(e.target.value as Severity | '')}
          className="w-40"
        >
          <option value="">All Severities</option>
          {(severitiesQuery.data ?? []).map((s) => (
            <option key={s.code} value={s.code}>
              {s.label}
            </option>
          ))}
        </Select>
        <Select
          aria-label="Filter by reporter"
          value={reportedBy}
          onChange={(e) => setReportedBy(e.target.value)}
          className="w-44"
        >
          <option value="">All Reporters</option>
          {usersQuery.data?.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name}
            </option>
          ))}
        </Select>
        <div className="flex flex-col gap-1">
          <Label htmlFor="defect-created-from" className="text-xs text-[var(--muted-foreground)]">
            Reported From
          </Label>
          <Input
            id="defect-created-from"
            type="date"
            value={createdFrom}
            onChange={(e) => setCreatedFrom(e.target.value)}
            className="w-36"
          />
        </div>
        <div className="flex flex-col gap-1">
          <Label htmlFor="defect-created-to" className="text-xs text-[var(--muted-foreground)]">
            Reported To
          </Label>
          <Input
            id="defect-created-to"
            type="date"
            value={createdTo}
            onChange={(e) => setCreatedTo(e.target.value)}
            className="w-36"
          />
        </div>
      </div>

      <div className="overflow-x-auto rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Severity</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">SLA</th>
              <th className="px-4 py-2 font-medium">Reported By</th>
              <th className="px-4 py-2 font-medium">Reported</th>
            </tr>
          </thead>
          <tbody>
            {defectsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No defects found.
                </td>
              </tr>
            )}
            {defectsQuery.data?.map((d) => (
              <tr key={d.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/defects/${d.id}`} className="font-medium underline-offset-2 hover:underline">
                    {d.title}
                  </Link>
                  {d.step_number !== null && (
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">step {d.step_number}</span>
                  )}
                </td>
                <td className="px-4 py-2">{d.project_name}</td>
                <td className="px-4 py-2">
                  <Badge tone={severityTone(d.severity)}>{d.severity}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[d.status]}>{d.status_label}</Badge>
                </td>
                <td className="px-4 py-2">
                  {d.sla_breached ? (
                    <Badge tone="critical">Breached</Badge>
                  ) : (
                    <span className="text-xs text-[var(--muted-foreground)]">{d.age_days}d</span>
                  )}
                </td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">{d.reported_by_name ?? 'Unknown'}</td>
                <td className="px-4 py-2 text-xs text-[var(--muted-foreground)]">
                  {new Date(d.created_at).toLocaleDateString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <NewDefectDialog
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        projects={projectsQuery.data?.items ?? []}
        onCreated={() => queryClient.invalidateQueries({ queryKey: ['defects'] })}
      />
    </div>
  )
}

function NewDefectDialog({
  open,
  onClose,
  projects,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  projects: { id: string; name: string }[]
  onCreated: () => void
}) {
  const [projectId, setProjectId] = useState('')
  const [title, setTitle] = useState('')
  const [severity, setSeverity] = useState<Severity>('Medium')
  const [description, setDescription] = useState('')
  const severitiesQuery = useQuery({
    queryKey: ['field-options', 'defect_severity'],
    queryFn: () => listFieldOptions('defect_severity'),
  })

  const createMutation = useMutation({
    mutationFn: () => createDefect({ project_id: projectId, title, severity, description }),
    onSuccess: () => {
      onCreated()
      setProjectId('')
      setTitle('')
      setSeverity('Medium')
      setDescription('')
      onClose()
    },
  })
  const serverError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <Dialog open={open} onClose={onClose} title="New Defect">
      <div className="flex flex-col gap-3 text-sm">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-project">Project</Label>
          <Select id="new-defect-project" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            <option value="">Select a project…</option>
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-title">Title</Label>
          <Input id="new-defect-title" value={title} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-severity">Severity</Label>
          <Select
            id="new-defect-severity"
            value={severity}
            onChange={(e) => setSeverity(e.target.value as Severity)}
          >
            {(severitiesQuery.data ?? []).map((s) => (
              <option key={s.code} value={s.code}>
                {s.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="new-defect-description">Description</Label>
          <Textarea
            id="new-defect-description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
        </div>
        {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        <div className="flex justify-end gap-2">
          <Button variant="outline" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="sm"
            disabled={!projectId || !title || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            {createMutation.isPending ? 'Creating…' : 'Create Defect'}
          </Button>
        </div>
      </div>
    </Dialog>
  )
}
