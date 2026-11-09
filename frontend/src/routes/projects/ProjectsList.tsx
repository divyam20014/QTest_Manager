import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import { ApiError } from '@/api/client'
import { createProject, listProjects, type ProjectCreateRequest } from '@/api/projects'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { useAuth } from '@/lib/auth'
import { ProjectForm, type ProjectFormValues } from './ProjectForm'

const DEFAULT_VALUES: ProjectFormValues = {
  name: '',
  domain: 'Motor',
  priority: 'Medium',
  status: 'On Track',
  manager_name: '',
  start_date: '',
  end_date: '',
  budget: '0',
  region: '',
}

export function ProjectsList() {
  const { user } = useAuth()
  const [createOpen, setCreateOpen] = useState(false)
  const queryClient = useQueryClient()

  const projectsQuery = useQuery({ queryKey: ['projects'], queryFn: listProjects })

  const createMutation = useMutation({
    mutationFn: (req: ProjectCreateRequest) => createProject(req),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] })
      setCreateOpen(false)
    },
  })

  const canCreate = user?.role === 'admin' || user?.role === 'manager'
  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold">Projects</h1>
        {canCreate && <Button onClick={() => setCreateOpen(true)}>New Project</Button>}
      </div>

      <div className="overflow-hidden rounded-lg border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead className="bg-[var(--muted)] text-left text-xs text-[var(--muted-foreground)]">
            <tr>
              <th className="px-4 py-2 font-medium">Name</th>
              <th className="px-4 py-2 font-medium">Domain</th>
              <th className="px-4 py-2 font-medium">Status</th>
              <th className="px-4 py-2 font-medium">Priority</th>
              <th className="px-4 py-2 font-medium">Manager</th>
              <th className="px-4 py-2 font-medium">Region</th>
            </tr>
          </thead>
          <tbody>
            {projectsQuery.data?.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-[var(--muted-foreground)]">
                  No projects yet.
                </td>
              </tr>
            )}
            {projectsQuery.data?.map((project) => (
              <tr key={project.id} className="border-t border-[var(--border)] hover:bg-[var(--muted)]">
                <td className="px-4 py-2">
                  <Link to={`/projects/${project.id}`} className="font-medium underline-offset-2 hover:underline">
                    {project.name}
                  </Link>
                </td>
                <td className="px-4 py-2">{project.domain}</td>
                <td className="px-4 py-2">{project.status}</td>
                <td className="px-4 py-2">{project.priority}</td>
                <td className="px-4 py-2">{project.manager_name}</td>
                <td className="px-4 py-2">{project.region}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Dialog open={createOpen} onClose={() => setCreateOpen(false)} title="New Project">
        <ProjectForm
          defaultValues={DEFAULT_VALUES}
          submitLabel="Create Project"
          isSubmitting={createMutation.isPending}
          serverError={createError}
          onSubmit={(values) => createMutation.mutate(values)}
        />
      </Dialog>
    </div>
  )
}
