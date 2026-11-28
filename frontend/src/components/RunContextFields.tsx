import { useQuery } from '@tanstack/react-query'

import { listBuilds, listEnvironments, listReleases } from '@/api/testAssets'
import { Combobox } from '@/components/ui/combobox'
import { FormField } from '@/components/ui/form-field'

export interface RunContext {
  environment_id: string
  build_id: string
  release_id: string
}

export const NO_CONTEXT: RunContext = { environment_id: '', build_id: '', release_id: '' }

/**
 * ADR-152: what a test run is run against. Searchable pickers; a build that belongs to a release brings
 * that release, so the release is then shown and not asked for.
 */
export function RunContextFields({
  projectId,
  value,
  onChange,
  required = false,
  errors = {},
}: {
  projectId: string
  value: RunContext
  onChange: (next: RunContext) => void
  /** The organization requires an environment and a build on every run. */
  required?: boolean
  errors?: Record<string, string | undefined>
}) {
  const environments = useQuery({ queryKey: ['environments'], queryFn: listEnvironments })
  const builds = useQuery({ queryKey: ['builds', projectId], queryFn: () => listBuilds(projectId) })
  const releases = useQuery({ queryKey: ['releases', projectId], queryFn: () => listReleases(projectId) })

  const chosenBuild = builds.data?.find((b) => b.id === value.build_id)
  const releaseFromBuild = chosenBuild?.release_id ?? ''
  const release = releaseFromBuild || value.release_id
  const none = { value: '', label: 'None' }

  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <FormField id="run-environment" label="Environment" required={required} error={errors.environment_id}>
        {(f) => (
          <Combobox
            id={f.id}
            aria-label="Environment"
            searchable
            value={value.environment_id}
            onChange={(environment_id) => onChange({ ...value, environment_id })}
            placeholder="Choose…"
            options={[none, ...(environments.data ?? []).map((e) => ({ value: e.id, label: e.name }))]}
          />
        )}
      </FormField>
      <FormField id="run-build" label="Build" required={required} error={errors.build_id}>
        {(f) => (
          <Combobox
            id={f.id}
            aria-label="Build"
            searchable
            value={value.build_id}
            onChange={(build_id) => onChange({ ...value, build_id, release_id: '' })}
            placeholder="Choose…"
            options={[none, ...(builds.data ?? []).map((b) => ({ value: b.id, label: b.name }))]}
          />
        )}
      </FormField>
      <FormField
        id="run-release"
        label="Release"
        helper={releaseFromBuild ? 'From the build.' : undefined}
        error={errors.release_id}
      >
        {(f) => (
          <Combobox
            id={f.id}
            aria-label="Release"
            searchable
            disabled={!!releaseFromBuild}
            value={release}
            onChange={(release_id) => onChange({ ...value, release_id })}
            placeholder="Choose…"
            options={[none, ...(releases.data ?? []).map((r) => ({ value: r.id, label: r.name }))]}
          />
        )}
      </FormField>
    </div>
  )
}
