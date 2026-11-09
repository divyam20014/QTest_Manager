import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { listDefects, type DefectStatus, type Severity } from '@/api/defects'
import { listProjects } from '@/api/projects'
import { listUsers } from '@/api/users'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Select } from '@/components/ui/select'
import { SEVERITY_TONE, STATUS_ORDER, STATUS_TONE } from './statusDisplay'

const SEVERITIES: Severity[] = ['Low', 'Medium', 'High', 'Critical']

export function DefectsList() {
  const [projectId, setProjectId] = useState('')
  const [status, setStatus] = useState<DefectStatus | ''>('')
  const [severity, setSeverity] = useState<Severity | ''>('')
  const [reportedBy, setReportedBy] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')

  const projectsQuery = useQuery({
    queryKey: ['projects', 'all-for-filter'],
    queryFn: () => listProjects({ page_size: 100, sort: 'name' }),
  })
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers })
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

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Defects</h1>

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
          {SEVERITIES.map((s) => (
            <option key={s} value={s}>
              {s}
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

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Title</th>
              <th className="px-4 py-2 font-medium">Project</th>
              <th className="px-4 py-2 font-medium">Severity</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Reported By</th>
              <th className="px-4 py-2 font-medium">Reported</th>
            </tr>
          </thead>
          <tbody>
            {defectsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
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
                  <Badge tone={SEVERITY_TONE[d.severity]}>{d.severity}</Badge>
                </td>
                <td className="px-4 py-2">
                  <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
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
    </div>
  )
}
