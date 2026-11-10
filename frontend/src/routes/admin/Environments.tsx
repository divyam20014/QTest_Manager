import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { createEnvironment, deleteEnvironment, listEnvironments } from '@/api/testAssets'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

// Tier 2 (PV-8.1): tenant-wide Environments (Staging/Production/etc.),
// shared across projects -- distinct from project-scoped Builds/Releases,
// which are managed on each project's own detail page.
export function Environments() {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')

  const environmentsQuery = useQuery({ queryKey: ['environments'], queryFn: listEnvironments })

  const createMutation = useMutation({
    mutationFn: () => createEnvironment({ name, description: description || undefined }),
    onSuccess: () => {
      setName('')
      setDescription('')
      queryClient.invalidateQueries({ queryKey: ['environments'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteEnvironment(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['environments'] }),
  })

  const createError = createMutation.error instanceof ApiError ? createMutation.error.message : null

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Environments</h1>
      <Card>
        <CardHeader>
          <CardTitle>Test Environments</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <ul className="flex flex-col gap-2 text-sm">
            {(environmentsQuery.data ?? []).length === 0 && (
              <li className="text-[var(--muted-foreground)]">No environments defined yet.</li>
            )}
            {environmentsQuery.data?.map((env) => (
              <li
                key={env.id}
                className="flex items-center justify-between border-b border-[var(--border)] pb-2 last:border-0"
              >
                <div>
                  <p className="font-medium">{env.name}</p>
                  {env.description && (
                    <p className="text-xs text-[var(--muted-foreground)]">{env.description}</p>
                  )}
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => deleteMutation.mutate(env.id)}
                  disabled={deleteMutation.isPending}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>

          <form
            className="flex flex-col gap-3 border-t border-[var(--border)] pt-4 sm:flex-row sm:items-end"
            onSubmit={(e) => {
              e.preventDefault()
              createMutation.mutate()
            }}
          >
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="env-name">Name</Label>
              <Input
                id="env-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Staging"
              />
            </div>
            <div className="flex flex-1 flex-col gap-1.5">
              <Label htmlFor="env-description">Description</Label>
              <Input
                id="env-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="Optional"
              />
            </div>
            <Button type="submit" size="sm" disabled={!name || createMutation.isPending}>
              Add Environment
            </Button>
          </form>
          {createError && <p className="text-xs text-[var(--destructive)]">{createError}</p>}
        </CardContent>
      </Card>
    </div>
  )
}
