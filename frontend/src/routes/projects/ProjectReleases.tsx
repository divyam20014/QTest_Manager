import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import {
  RELEASE_STATUSES,
  createBuild,
  createRelease,
  deleteBuild,
  deleteRelease,
  listBuilds,
  listReleases,
  updateRelease,
  type Release,
  type ReleaseStatus,
} from '@/api/testAssets'
import { Button } from '@/components/ui/button'
import { Combobox } from '@/components/ui/combobox'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogFooter } from '@/components/ui/dialog'
import { FormError, FormField } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Select } from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { useConfirm } from '@/components/ui/useConfirm'
import { useToast } from '@/lib/toast'

function ReleaseEditDialog({
  release,
  projectId,
  onClose,
}: {
  release: Release | null
  projectId: string
  onClose: () => void
}) {
  return (
    <Dialog open={release !== null} onClose={onClose} title="Edit release">
      {release && <ReleaseEditForm key={release.id} release={release} projectId={projectId} onClose={onClose} />}
    </Dialog>
  )
}

function ReleaseEditForm({
  release,
  projectId,
  onClose,
}: {
  release: Release
  projectId: string
  onClose: () => void
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [name, setName] = useState(release.name)
  const [date, setDate] = useState(release.release_date ?? '')
  const [status, setStatus] = useState<ReleaseStatus | ''>(release.status ?? '')
  const [notes, setNotes] = useState(release.notes ?? '')
  const mutation = useMutation({
    mutationFn: () =>
      updateRelease(release.id, {
        name: name.trim(),
        release_date: date || null,
        status: status || null,
        notes: notes.trim() || null,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
      showToast('success', 'Release updated')
      onClose()
    },
  })
  const error =
    mutation.error instanceof ApiError ? mutation.error.message : mutation.error ? 'Could not save this release.' : null
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault()
        if (name.trim()) mutation.mutate()
      }}
    >
      <FormField id="release-name" label="Name" required>
        {(field) => <Input {...field} value={name} onChange={(e) => setName(e.target.value)} />}
      </FormField>
      <FormField id="release-date" label="Target date">
        {(field) => <Input {...field} type="date" value={date} onChange={(e) => setDate(e.target.value)} />}
      </FormField>
      <FormField id="release-status" label="Status">
        {(field) => (
          <Select {...field} value={status} onChange={(e) => setStatus(e.target.value as ReleaseStatus | '')}>
            <option value="">Not set</option>
            {RELEASE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField id="release-notes" label="Notes">
        {(field) => <Textarea {...field} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
      </FormField>
      <FormError>{error}</FormError>
      <DialogFooter>
        <Button type="button" variant="outline" onClick={onClose}>
          Cancel
        </Button>
        <Button type="submit" disabled={!name.trim() || mutation.isPending}>
          Save release
        </Button>
      </DialogFooter>
    </form>
  )
}

export function BuildsReleasesCard({ projectId, canManage }: { projectId: string; canManage: boolean }) {
  const queryClient = useQueryClient()
  const [buildName, setBuildName] = useState('')
  const [buildRelease, setBuildRelease] = useState('')
  const [releaseName, setReleaseName] = useState('')
  const [editing, setEditing] = useState<Release | null>(null)
  const { show: showToast } = useToast()
  const { ask, dialog: confirmDialog } = useConfirm()

  const buildsQuery = useQuery({
    queryKey: ['builds', projectId],
    queryFn: () => listBuilds(projectId),
  })
  const releasesQuery = useQuery({
    queryKey: ['releases', projectId],
    queryFn: () => listReleases(projectId),
  })

  const createBuildMutation = useMutation({
    mutationFn: () => createBuild(projectId, { name: buildName, release_id: buildRelease || null }),
    onSuccess: () => {
      setBuildName('')
      setBuildRelease('')
      queryClient.invalidateQueries({ queryKey: ['builds', projectId] })
      showToast('success', 'Build added')
    },
    onError: () => showToast('error', 'Could not add that build'),
  })
  const deleteBuildMutation = useMutation({
    mutationFn: (id: string) => deleteBuild(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['builds', projectId] })
      showToast('success', 'Build removed')
    },
    onError: () => showToast('error', 'Could not remove that build'),
  })
  const createReleaseMutation = useMutation({
    mutationFn: () => createRelease(projectId, { name: releaseName }),
    onSuccess: () => {
      setReleaseName('')
      queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
      showToast('success', 'Release added')
    },
    onError: () => showToast('error', 'Could not add that release'),
  })
  const deleteReleaseMutation = useMutation({
    mutationFn: (id: string) => deleteRelease(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['releases', projectId] })
      showToast('success', 'Release removed')
    },
    onError: () => showToast('error', 'Could not remove that release'),
  })

  return (
    <Card>
      <CardHeader>
        <CardTitle>Builds &amp; Releases</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        {confirmDialog}
        <ReleaseEditDialog release={editing} onClose={() => setEditing(null)} projectId={projectId} />
        <div>
          <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Builds</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(buildsQuery.data ?? []).length === 0 && (
              <li className="text-[var(--muted-foreground)]">No builds recorded.</li>
            )}
            {buildsQuery.data?.map((b) => (
              <li key={b.id} className="flex items-center justify-between">
                <span>
                  {b.name}
                  <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                    {releasesQuery.data?.find((r) => r.id === b.release_id)?.name ?? 'No release'}
                  </span>
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: `Remove build “${b.name}”?`,
                        description:
                          'The build is removed from this project and can no longer be picked for runs. Runs that already used it keep their history.',
                        confirmLabel: 'Remove build',
                        run: () => deleteBuildMutation.mutateAsync(b.id),
                      })
                    }
                    disabled={deleteBuildMutation.isPending}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                placeholder="New build name" aria-label="New build name"
                value={buildName}
                onChange={(e) => setBuildName(e.target.value)}
              />
              <div className="w-44">
                <Combobox
                  id="new-build-release"
                  aria-label="Release of the new build"
                  searchable
                  value={buildRelease}
                  onChange={setBuildRelease}
                  placeholder="No release"
                  options={[{ value: '', label: 'No release' }, ...(releasesQuery.data ?? []).map((r) => ({ value: r.id, label: r.name }))]}
                />
              </div>
              <Button
                size="sm"
                disabled={!buildName || createBuildMutation.isPending}
                onClick={() => createBuildMutation.mutate()}
              >
                Add
              </Button>
            </div>
          )}
        </div>

        <div className="border-t border-[var(--border)] pt-3">
          <p className="mb-1.5 text-xs font-medium text-[var(--muted-foreground)]">Releases</p>
          <ul className="flex flex-col gap-1.5 text-sm">
            {(releasesQuery.data ?? []).length === 0 && (
              <li className="text-[var(--muted-foreground)]">No releases recorded.</li>
            )}
            {releasesQuery.data?.map((r) => (
              <li key={r.id} className="flex items-center justify-between gap-2">
                <span className="min-w-0">
                  {r.name}
                  {(r.status || r.release_date) && (
                    <span className="ml-2 text-xs text-[var(--muted-foreground)]">
                      {[r.status, r.release_date].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </span>
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-label={`Edit release ${r.name}`}
                    onClick={() => setEditing(r)}
                  >
                    Edit
                  </Button>
                )}
                {canManage && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      ask({
                        title: `Remove release “${r.name}”?`,
                        description:
                          'The release is removed from this project and no longer appears in readiness views. This cannot be undone.',
                        confirmLabel: 'Remove release',
                        run: () => deleteReleaseMutation.mutateAsync(r.id),
                      })
                    }
                    disabled={deleteReleaseMutation.isPending}
                  >
                    Remove
                  </Button>
                )}
              </li>
            ))}
          </ul>
          {canManage && (
            <div className="mt-2 flex gap-2">
              <Input
                className="flex-1"
                placeholder="New release name" aria-label="New release name"
                value={releaseName}
                onChange={(e) => setReleaseName(e.target.value)}
              />
              <Button
                size="sm"
                disabled={!releaseName || createReleaseMutation.isPending}
                onClick={() => createReleaseMutation.mutate()}
              >
                Add
              </Button>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
