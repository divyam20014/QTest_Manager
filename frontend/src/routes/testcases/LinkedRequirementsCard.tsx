import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ApiError } from '@/api/client'
import { linkTestCase, listRequirements, unlinkTestCase } from '@/api/requirements'
import { listLinkedRequirements } from '@/api/testCases'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormError } from '@/components/ui/form-field'
import { MultiCombobox } from '@/components/ui/multi-combobox'
import { requirementPath } from '@/lib/entityRoutes'

/** Requirements covered by this case; managers can link/unlink via a typeahead (ADR-106). */
export function LinkedRequirementsCard({
  testCaseId,
  projectId,
  canManage,
}: {
  testCaseId: string
  projectId: string
  canManage: boolean
}) {
  const queryClient = useQueryClient()
  const linkedKey = ['test-case-requirements', testCaseId]
  const linkedQuery = useQuery({ queryKey: linkedKey, queryFn: () => listLinkedRequirements(testCaseId) })
  // The list endpoint has no search param: fetch the project's requirements (max page) once
  // and filter client-side. Only when the user can edit links.
  const optionsQuery = useQuery({
    queryKey: ['requirements', projectId, 'picker'],
    queryFn: () => listRequirements(projectId, { page_size: 100 }),
    enabled: canManage,
  })
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: linkedKey })
    queryClient.invalidateQueries({ queryKey: ['requirements', projectId] })
  }
  const link = useMutation({ mutationFn: (rid: string) => linkTestCase(rid, testCaseId), onSuccess: refresh })
  const unlink = useMutation({ mutationFn: (rid: string) => unlinkTestCase(rid, testCaseId), onSuccess: refresh })
  const linked = linkedQuery.data ?? []
  const err = [link.error, unlink.error].find((e) => e instanceof ApiError) as ApiError | undefined

  return (
    <Card>
      <CardHeader>
        <CardTitle>Linked Requirements {linked.length > 0 && `(${linked.length})`}</CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-2 text-sm">
        {!canManage && linked.length === 0 && (
          <p className="text-[var(--muted-foreground)]">No requirements linked to this test case.</p>
        )}
        {(canManage || linked.length > 0) && (
          <MultiCombobox
            label="Requirements"
            options={(optionsQuery.data?.items ?? []).map((r) => ({ id: r.id, label: r.title }))}
            selected={linked.map((r) => ({ id: r.id, label: r.title, href: requirementPath(projectId, r.id) }))}
            onAdd={(id) => link.mutate(id)}
            onRemove={(id) => unlink.mutate(id)}
            removeLabel={(r) => `Remove requirement ${r.label}`}
            placeholder="Search requirements to link…"
            disabled={!canManage}
            busy={optionsQuery.isLoading || link.isPending || unlink.isPending}
            emptyText="No matching requirements"
          />
        )}
        <FormError>{err?.message}</FormError>
      </CardContent>
    </Card>
  )
}
