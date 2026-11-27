import { StaleWriteNotice } from '@/components/StaleWriteNotice'
import { isStaleWrite, rebaseValues } from '@/lib/staleWrite'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Copy } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useNavigate, useParams } from 'react-router-dom'

import { hasPermission } from '@/api/auth'
import { ApiError } from '@/api/client'
import { listFieldOptions } from '@/api/fieldCustomization'
import { createModule, listModules } from '@/api/modules'
import { getProject } from '@/api/projects'
import {
  AUTOMATION_STATUSES,
  createTestCase,
  getTestCase,
  submitForReview,
  updateTestCase,
  type AutomationStatus,
  type TestCase,
} from '@/api/testCases'
import { listSharedSteps } from '@/api/sharedSteps'
import { listUsers } from '@/api/users'
import { AttachmentsCard } from '@/components/AttachmentsCard'
import { CommentsCard } from '@/components/CommentsCard'
import { FormSection } from '@/components/FormSection'
import { MarkdownEditor } from '@/components/Markdown'
import { NoAccess } from '@/components/NoAccess'
import { StepBuilder } from '@/components/StepBuilder'
import { Button } from '@/components/ui/button'
import { EmptyState, ErrorState } from '@/components/ui/empty-state'
import { FormError, FormField } from '@/components/ui/form-field'
import { IconButton } from '@/components/ui/icon-button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { PageHeader } from '@/components/ui/PageHeader'
import { Select } from '@/components/ui/select'
import { DetailSkeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { useAuth } from '@/lib/auth'
import { copyText } from '@/lib/clipboard'
import { MAX_STEPS, mapStepServerErrors, newStep, validateSteps } from '@/lib/stepBuilder'
import {
  MODULE_LEVELS,
  SECTION_OF,
  SECTION_TITLES,
  childModules,
  emptyFormValues,
  isDirty,
  jsonProblem,
  looksLikeJson,
  mapServerFields,
  modulePathIds,
  prettyJson,
  sectionsWithErrors,
  toCreateRequest,
  toUpdateRequest,
  validateForm,
  valuesFromTestCase,
  type FormErrors,
  type FormFieldKey,
  type ModuleNode,
  type TestCaseFormValues,
} from '@/lib/testCaseForm'
import { useToast } from '@/lib/toast'
import { useCanListUsers } from '@/lib/useCanListUsers'
import { useUnsavedGuard } from '@/lib/useUnsavedGuard'
import { ExecutionStatusBadge } from './ExecutionStatusBadge'
import { defectPath, testCasePath } from '@/lib/entityRoutes'

/** Values handed over by Quick add's "More options" (router state). */
export interface FormPrefill {
  prefill?: Partial<TestCaseFormValues>
}

export function TestCaseCreatePage() {
  const { projectId } = useParams<{ projectId: string }>()
  const { user } = useAuth()
  if (!hasPermission(user, 'testcase.create')) return <NoAccess />
  return <TestCaseFormPage mode="create" projectId={projectId!} />
}

export function TestCaseEditPage() {
  const { testCaseId } = useParams<{ testCaseId: string }>()
  const { user } = useAuth()
  const query = useQuery({
    queryKey: ['test-cases', 'detail', testCaseId],
    queryFn: () => getTestCase(testCaseId!),
    enabled: !!testCaseId,
    // The form keeps the copy it opens with (ADR-136), so it must not open a cached one.
    refetchOnMount: 'always',
  })
  if (!hasPermission(user, 'testcase.edit')) return <NoAccess />
  if (query.isLoading || !query.isFetchedAfterMount) return <DetailSkeleton />
  if (query.isError) return <ErrorState message="Could not load this test case." error={query.error} onRetry={() => query.refetch()} />
  if (!query.data) return <EmptyState title="Test case not found" description="It may have been deleted, or you may not have access to it." />
  return <TestCaseFormPage mode="edit" projectId={query.data.project_id} testCase={query.data} />
}

function TestCaseFormPage({
  mode,
  projectId,
  testCase,
}: {
  mode: 'create' | 'edit'
  projectId: string
  testCase?: TestCase
}) {
  const navigate = useNavigate()
  const location = useLocation()
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const { user } = useAuth()
  const prefill = (location.state as FormPrefill | null)?.prefill

  // `initial` is what "unchanged" means: the saved case, or a blank form. Entries carried over from
  // Quick add (`prefill`) are the user's own unsaved input, so they count as changes.
  // ADR-136: the copy the form was opened with. A background refetch must not replace it, or
  // saving would compare old entries with newer values and undo someone else's change.
  const [opened, setOpened] = useState(() => ({
    values: testCase ? valuesFromTestCase(testCase) : emptyFormValues(),
    version: testCase?.row_version,
  }))
  const initial = opened.values
  const [staleFields, setStaleFields] = useState<string[] | null>(null)
  const [values, setValues] = useState<TestCaseFormValues>(() => (testCase ? initial : emptyFormValues(prefill)))
  const [touched, setTouched] = useState<Partial<Record<FormFieldKey, true>>>({})
  const [serverErrors, setServerErrors] = useState<FormErrors>({})
  const [stepServerErrors, setStepServerErrors] = useState<ReturnType<typeof mapStepServerErrors>>({})
  const [formError, setFormError] = useState<string | null>(null)
  const [submitted, setSubmitted] = useState(false)
  const [open, setOpen] = useState<Record<number, boolean>>({ 1: true, 2: true, 3: true, 4: true, 5: mode === 'edit', 6: false })
  const sectionRefs = useRef<Record<number, HTMLElement | null>>({})
  const opts = mode === 'edit' ? { initial } : {}

  const dirty = isDirty(values, initial)
  const guard = useUnsavedGuard(dirty && !submitted)

  const canListUsers = useCanListUsers()
  const usersQuery = useQuery({ queryKey: ['users'], queryFn: listUsers, enabled: canListUsers })
  const projectQuery = useQuery({ queryKey: ['projects', projectId], queryFn: () => getProject(projectId), enabled: !!projectId })
  const modulesQuery = useQuery({ queryKey: ['test-modules', projectId], queryFn: () => listModules(projectId) })
  const prioritiesQuery = useQuery({ queryKey: ['field-options', 'test_case_priority'], queryFn: () => listFieldOptions('test_case_priority') })
  const typesQuery = useQuery({ queryKey: ['field-options', 'test_type'], queryFn: () => listFieldOptions('test_type') })
  const sharedStepsQuery = useQuery({ queryKey: ['shared-steps', projectId], queryFn: () => listSharedSteps(projectId), enabled: !!projectId })
  const [libraryPick, setLibraryPick] = useState('')
  const severitiesQuery = useQuery({ queryKey: ['field-options', 'test_case_severity'], queryFn: () => listFieldOptions('test_case_severity') })

  // A new case starts at Medium (or the middle option when the tenant renamed them).
  const priorityOptions = useMemo(() => prioritiesQuery.data ?? [], [prioritiesQuery.data])
  useEffect(() => {
    if (mode !== 'create' || priorityOptions.length === 0) return
    const preferred = priorityOptions.find((p) => p.code === 'Medium') ?? priorityOptions[Math.floor((priorityOptions.length - 1) / 2)]
    setValues((v) => (v.priority ? v : { ...v, priority: preferred.code }))
  }, [mode, priorityOptions])

  const errors: FormErrors = useMemo(() => {
    const out: FormErrors = {}
    const keys = Object.keys(SECTION_OF) as FormFieldKey[]
    const all = validateForm(values, opts)
    for (const key of keys) {
      const message = serverErrors[key] ?? (submitted || touched[key] ? all[key] : undefined)
      if (message) out[key] = message
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [values, touched, serverErrors, submitted])

  function set<K extends keyof TestCaseFormValues>(key: K, value: TestCaseFormValues[K]) {
    setValues((v) => ({ ...v, [key]: value }))
    // Editing a field clears the server's message about it.
    if (serverErrors[key as FormFieldKey]) clearServerError(key as FormFieldKey)
  }
  function clearServerError(key: FormFieldKey) {
    setServerErrors((s) => {
      const next = { ...s }
      delete next[key]
      return next
    })
  }
  function blur(key: FormFieldKey) {
    setTouched((t) => (t[key] ? t : { ...t, [key]: true }))
  }

  const saveMutation = useMutation({
    mutationFn: async ({ submit }: { submit: boolean }): Promise<TestCase> => {
      if (mode === 'create') {
        const created = await createTestCase(projectId, toCreateRequest(values))
        if (submit) {
          try {
            await submitForReview(created.id)
          } catch {
            showToast('warning', 'Saved as a draft, but it could not be submitted for review yet.')
          }
        }
        return created
      }
      return updateTestCase(testCase!.id, { ...toUpdateRequest(values, initial), expected_version: opened.version })
    },
    onSuccess: (saved, { submit }) => {
      setSubmitted(true)
      queryClient.invalidateQueries({ queryKey: ['test-cases'] })
      queryClient.invalidateQueries({ queryKey: ['test-repository'] })
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
      showToast(
        'success',
        mode === 'create'
          ? submit
            ? `Test case ${saved.display_id ?? ''} saved and submitted for review`
            : `Test case ${saved.display_id ?? ''} saved as a draft`
          : 'Test case updated',
      )
      navigate(testCasePath(saved.project_id, saved.id))
    },
    onError: async (err) => {
      if (isStaleWrite(err)) {
        try {
          const latest = await getTestCase(testCase!.id)
          const theirs = valuesFromTestCase(latest)
          const rebased = rebaseValues(values, initial, theirs)
          setOpened({ values: theirs, version: latest.row_version })
          setValues(rebased.values)
          setStaleFields(rebased.bothChanged)
          setSubmitted(false)
          void queryClient.invalidateQueries({ queryKey: ['test-cases'] })
          return
        } catch {
          // The latest copy could not be read: show the API's message and keep the form as it is.
        }
      }
      // Data stays in the form; the API's per-field messages go onto the fields.
      if (err instanceof ApiError && err.fields) {
        const mapped = mapServerFields(err.fields)
        setServerErrors(mapped.errors)
        setStepServerErrors(mapStepServerErrors(err.fields))
        setFormError(mapped.other.length > 0 ? mapped.other.join('; ') : err.message)
        const bad = sectionsWithErrors(mapped.errors)
        if (bad.length) {
          setOpen((o) => ({ ...o, ...Object.fromEntries(bad.map((n) => [n, true])) }))
          requestAnimationFrame(() => sectionRefs.current[bad[0]]?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
        }
      } else {
        setFormError(err instanceof ApiError ? err.message : 'Could not save the test case. Your entries are still here; try again.')
      }
    },
  })

  function save(submit: boolean) {
    setFormError(null)
    setStaleFields(null)
    setServerErrors({})
    setStepServerErrors({})
    setSubmitted(true)
    const found = validateForm(values, opts)
    const bad = sectionsWithErrors(found)
    if (bad.length > 0) {
      setOpen((o) => ({ ...o, ...Object.fromEntries(bad.map((n) => [n, true])) }))
      setFormError(`Fix ${Object.keys(found).length} field${Object.keys(found).length === 1 ? '' : 's'} marked below, then save again.`)
      requestAnimationFrame(() => sectionRefs.current[bad[0]]?.scrollIntoView({ block: 'start', behavior: 'smooth' }))
      return
    }
    if (mode === 'edit' && !dirty) {
      showToast('info', 'No changes to save')
      return
    }
    saveMutation.mutate({ submit })
  }

  const modules: ModuleNode[] = modulesQuery.data ?? []
  const backTo = mode === 'edit' ? testCasePath(testCase!.project_id, testCase!.id) : `/projects/${projectId}/test-cases`
  const pending = saveMutation.isPending
  const errorCountBySection = useMemo(() => {
    const counts: Record<number, number> = {}
    for (const key of Object.keys(errors) as FormFieldKey[]) {
      if (errors[key]) counts[SECTION_OF[key]] = (counts[SECTION_OF[key]] ?? 0) + 1
    }
    // A step row error counts as one on the steps section.
    return counts
  }, [errors])
  const stepErrorsNow = (submitted || Object.keys(stepServerErrors).length > 0) && validateSteps(values.steps).some((e) => e.action || e.expected)
  if (stepErrorsNow && !errorCountBySection[4]) errorCountBySection[4] = 1

  function sectionProps(n: number) {
    return {
      number: n,
      title: SECTION_TITLES[n],
      open: !!open[n],
      errorCount: errorCountBySection[n] ?? 0,
      onToggle: () => setOpen((o) => ({ ...o, [n]: !o[n] })),
      sectionRef: (el: HTMLElement | null) => {
        sectionRefs.current[n] = el
      },
    }
  }

  const isLegacy = mode === 'edit' && (!testCase?.display_id)
  const autoStatus = testCase?.review_status === 'approved'

  return (
    <div className="flex flex-col gap-4 pb-4">
      <PageHeader
        back={
          <Link
            to={backTo}
            className="inline-flex text-xs text-[var(--muted-foreground)] hover:underline max-md:min-h-11 max-md:items-center max-md:text-sm"
          >
            ← {mode === 'edit' ? (testCase?.title ?? 'Test case') : (projectQuery.data?.name ?? 'Test Cases')}
          </Link>
        }
        title={mode === 'create' ? 'New Test Case' : 'Edit Test Case'}
        description={
          mode === 'create'
            ? 'Fields marked * are required. A new test case starts in Draft.'
            : 'Fields marked * are required. Changing the steps or content creates a new version.'
        }
        actions={
          <div className="flex items-center gap-2 text-xs">
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen({ 1: true, 2: true, 3: true, 4: true, 5: true, 6: true })}>
              Expand all
            </Button>
            <Button type="button" variant="ghost" size="sm" onClick={() => setOpen({})}>
              Collapse all
            </Button>
          </div>
        }
      />

      {autoStatus && (
        <p className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
          This test case is Approved. Saving changes to its steps or content returns it to Draft for a new review.
        </p>
      )}
      {testCase?.status === 'deprecated' && (
        <p className="rounded-md border border-[var(--status-warning)]/30 bg-[var(--status-warning-bg)] px-3 py-2 text-sm">
          This test case is Deprecated. Its steps and content can&apos;t be changed, so past results keep the text they were
          run against. You can still change details such as priority and module. To change the content, duplicate the test
          case.
        </p>
      )}

      <form
        className="flex flex-col gap-4"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          save(false)
        }}
      >
        {/* 1 Basic Information */}
        <FormSection idPrefix="tc" {...sectionProps(1)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tc-display-id">Test Case ID</Label>
              <div className="flex items-center gap-1">
                <Input
                  id="tc-display-id"
                  readOnly
                  value={testCase?.display_id ?? ''}
                  placeholder="Assigned when you save"
                  aria-describedby="tc-display-id-help"
                  className="bg-[var(--muted)]/40 font-mono"
                />
                {testCase?.display_id && (
                  <IconButton
                    aria-label="Copy test case ID"
                    variant="secondary"
                    onClick={async () => {
                      const ok = await copyText(testCase.display_id!)
                      showToast(ok ? 'success' : 'error', ok ? 'Test case ID copied' : 'Could not copy the ID')
                    }}
                  >
                    <Copy aria-hidden="true" />
                  </IconButton>
                )}
              </div>
              <p id="tc-display-id-help" className="text-xs text-[var(--muted-foreground)]">
                {isLegacy ? 'This older test case has no generated ID.' : 'Generated automatically and never changes.'}
              </p>
            </div>
            <FormField id="tc-requirement" label="Requirement / User Story ID" helper="For example US-142 or REQ-7.">
              {(f) => (
                <Input
                  {...f}
                  maxLength={200}
                  value={values.requirement_ref}
                  onChange={(e) => set('requirement_ref', e.target.value)}
                />
              )}
            </FormField>
          </div>

          <ModulePicker
            modules={modules}
            value={values.module_id}
            onChange={(id) => {
              set('module_id', id)
              blur('module_id')
            }}
            error={errors.module_id}
            projectId={projectId}
            loading={modulesQuery.isLoading}
          />

          <FormField id="tc-title" label="Title" required error={errors.title}>
            {(f) => (
              <Input
                {...f}
                maxLength={255}
                value={values.title}
                onChange={(e) => set('title', e.target.value)}
                onBlur={() => blur('title')}
              />
            )}
          </FormField>

          <MarkdownEditor
            id="tc-description"
            label="Description"
            value={values.description}
            onChange={(v) => set('description', v)}
            helper="Markdown is supported (lists, tables, **bold**). HTML is not stored."
            rows={4}
            maxLength={20000}
          />
        </FormSection>

        {/* 2 Classification */}
        <FormSection idPrefix="tc" {...sectionProps(2)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <FormField id="tc-type" label="Test Type" error={errors.test_type}>
              {(f) => (
                <Select {...f} value={values.test_type} onChange={(e) => set('test_type', e.target.value)}>
                  <option value="">Not set</option>
                  {values.test_type && !(typesQuery.data ?? []).some((o) => o.code === values.test_type) && (
                    <option value={values.test_type}>{values.test_type}</option>
                  )}
                  {(typesQuery.data ?? []).map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="tc-priority" label="Priority" required error={errors.priority}>
              {(f) => (
                <Select
                  {...f}
                  value={values.priority}
                  onChange={(e) => {
                    set('priority', e.target.value)
                    blur('priority')
                  }}
                >
                  {priorityOptions.map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="tc-severity" label="Severity" error={errors.severity}>
              {(f) => (
                <Select {...f} value={values.severity} onChange={(e) => set('severity', e.target.value)}>
                  <option value="">Not set</option>
                  {values.severity && !(severitiesQuery.data ?? []).some((o) => o.code === values.severity) && (
                    <option value={values.severity}>{values.severity}</option>
                  )}
                  {(severitiesQuery.data ?? []).map((o) => (
                    <option key={o.code} value={o.code}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="tc-automation" label="Automation Status" error={errors.automation_status}>
              {(f) => (
                <Select
                  {...f}
                  value={values.automation_status}
                  onChange={(e) => set('automation_status', e.target.value as AutomationStatus)}
                >
                  {AUTOMATION_STATUSES.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField id="tc-environment" label="Environment" error={errors.environment} helper="For example QA, Staging, Production-like.">
              {(f) => <Input {...f} maxLength={200} value={values.environment} onChange={(e) => set('environment', e.target.value)} />}
            </FormField>
          </div>
        </FormSection>

        {/* 3 Test Preparation */}
        <FormSection idPrefix="tc" {...sectionProps(3)}>
          <MarkdownEditor
            id="tc-preconditions"
            label="Preconditions"
            required
            value={values.preconditions}
            onChange={(v) => set('preconditions', v)}
            onBlur={() => blur('preconditions')}
            error={errors.preconditions}
            helper="What must be true before the test starts (accounts, state, setup)."
            rows={3}
          />
          <TestDataField
            value={values.test_data}
            asJson={values.test_data_json}
            error={errors.test_data}
            onChange={(v) => set('test_data', v)}
            onAsJson={(v) => set('test_data_json', v)}
            onBlur={() => blur('test_data')}
          />
        </FormSection>

        {/* 4 Test Execution Instructions */}
        <FormSection idPrefix="tc" {...sectionProps(4)}>
          <StepBuilder
            steps={values.steps}
            onChange={(steps) => {
              setValues((v) => ({ ...v, steps }))
              if (serverErrors.steps) clearServerError('steps')
              if (Object.keys(stepServerErrors).length) setStepServerErrors({})
            }}
            showErrors={submitted}
            serverErrors={stepServerErrors}
          />
          {(sharedStepsQuery.data ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              <Select
                aria-label="Insert from shared step library"
                className="max-w-[18rem] max-md:max-w-none max-md:flex-1"
                value={libraryPick}
                onChange={(e) => setLibraryPick(e.target.value)}
              >
                <option value="">Insert from shared steps…</option>
                {(sharedStepsQuery.data ?? []).map((st) => (
                  <option key={st.id} value={st.id}>
                    {st.name}
                  </option>
                ))}
              </Select>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={!libraryPick || values.steps.length >= MAX_STEPS}
                onClick={() => {
                  const picked = (sharedStepsQuery.data ?? []).find((st) => st.id === libraryPick)
                  if (!picked) return
                  // A copy, not a live link (see SharedStepsDialog). An untouched empty first row is replaced.
                  setValues((v) => {
                    const blank = v.steps.length === 1 && !v.steps[0].action.trim() && !v.steps[0].expected.trim()
                    return { ...v, steps: [...(blank ? [] : v.steps), newStep({ action: picked.action, expected: picked.expected })] }
                  })
                  setLibraryPick('')
                }}
              >
                Insert
              </Button>
            </div>
          )}
          {errors.steps && !values.steps.some((s) => s.action || s.expected) && (
            <p role="alert" className="text-xs text-[var(--destructive)]">
              {errors.steps}
            </p>
          )}
          {serverErrors.steps && <p role="alert" className="text-xs text-[var(--destructive)]">{serverErrors.steps}</p>}
          <MarkdownEditor
            id="tc-expected"
            label="Expected Result"
            required
            value={values.expected_result}
            onChange={(v) => set('expected_result', v)}
            onBlur={() => blur('expected_result')}
            error={errors.expected_result}
            helper="The overall outcome that means this test case passes."
            rows={3}
          />
          <MarkdownEditor
            id="tc-postconditions"
            label="Postconditions"
            value={values.postconditions}
            onChange={(v) => set('postconditions', v)}
            helper="Optional: the state to restore or clean up afterwards."
            rows={3}
          />
        </FormSection>

        {/* 5 Execution Details (read-only) */}
        <FormSection idPrefix="tc" {...sectionProps(5)}>
          <ExecutionDetails testCase={testCase} />
        </FormSection>

        {/* 6 Additional Information */}
        <FormSection idPrefix="tc" {...sectionProps(6)}>
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="tc-created-by">Created By / Author</Label>
              <Input
                id="tc-created-by"
                readOnly
                className="bg-[var(--muted)]/40"
                value={mode === 'edit' ? (testCase?.created_by_name ?? 'Unknown') : (user?.name ?? 'You')}
              />
            </div>
            {canListUsers && (
              <FormField id="tc-assignee" label="Assignee">
                {(f) => (
                  <Select {...f} value={values.assignee_id} onChange={(e) => set('assignee_id', e.target.value)}>
                    <option value="">Unassigned</option>
                    {(usersQuery.data ?? []).map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            )}
            <FormField id="tc-scenario-id" label="Scenario ID">
              {(f) => <Input {...f} maxLength={200} value={values.scenario_id} onChange={(e) => set('scenario_id', e.target.value)} />}
            </FormField>
            <FormField id="tc-scenario-desc" label="Scenario Description">
              {(f) => (
                <Textarea
                  {...f}
                  rows={2}
                  value={values.scenario_description}
                  onChange={(e) => set('scenario_description', e.target.value)}
                />
              )}
            </FormField>
          </div>
          {mode === 'edit' && testCase ? (
            <div className="flex flex-col gap-4">
              <CommentsCard ownerType="test_case" ownerId={testCase.id} />
              <AttachmentsCard ownerType="test_case" ownerId={testCase.id} />
            </div>
          ) : (
            <p className="rounded-md border border-dashed border-[var(--border)] p-3 text-sm text-[var(--muted-foreground)]">
              Comments and attachments can be added as soon as the test case is saved.
            </p>
          )}
        </FormSection>

        {staleFields && testCase && (
          <StaleWriteNotice bothChanged={staleFields} savedUrl={testCasePath(testCase.project_id, testCase.id)} />
        )}
        <FormError>{formError}</FormError>

        {/* Sticky action bar: stays on screen however long the form is (phones: above the home indicator). */}
        <div className="sticky bottom-0 z-20 -mx-1 rounded-t-xl border-t border-[var(--border)] bg-[var(--background)]/95 px-4 py-3 backdrop-blur max-md:bottom-[calc(4.75rem+env(safe-area-inset-bottom))]">
          <div className="flex flex-wrap items-center justify-end gap-2 max-md:[&>button]:flex-1">
            <Button type="button" variant="ghost" disabled={pending} onClick={() => guard.leave(() => navigate(backTo))}>
              Cancel
            </Button>
            {mode === 'create' ? (
              <>
                <Button type="button" variant="outline" disabled={pending} onClick={() => save(true)}>
                  Save &amp; Submit for Review
                </Button>
                <Button type="submit" loading={pending}>
                  Save as Draft
                </Button>
              </>
            ) : (
              <Button type="submit" loading={pending}>
                Save changes
              </Button>
            )}
          </div>
        </div>
      </form>
      {guard.dialog}
    </div>
  )
}

/** Module / Sub-module / Feature: one select per level of the project's module tree; the deepest choice is saved. */
function ModulePicker({
  modules,
  value,
  onChange,
  error,
  projectId,
  loading,
}: {
  modules: ModuleNode[]
  value: string
  onChange: (id: string) => void
  error?: string
  projectId: string
  loading: boolean
}) {
  const queryClient = useQueryClient()
  const { show: showToast } = useToast()
  const [newName, setNewName] = useState('')
  const path = value ? modulePathIds(modules, value) : []
  const levels: { parent: string | null; options: ModuleNode[] }[] = []
  let parent: string | null = null
  for (let i = 0; i <= path.length; i++) {
    const options = childModules(modules, parent)
    if (options.length === 0) break
    levels.push({ parent, options })
    parent = path[i] ?? null
    if (!parent) break
  }
  const addRoot = useMutation({
    mutationFn: () => createModule(projectId, { name: newName.trim() }),
    onSuccess: (created) => {
      setNewName('')
      queryClient.invalidateQueries({ queryKey: ['test-modules', projectId] })
      onChange(created.id)
      showToast('success', `Module "${created.name}" created`)
    },
    onError: (err) => showToast('error', err instanceof ApiError ? err.message : 'Could not create the module'),
  })

  if (!loading && modules.length === 0) {
    return (
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="tc-new-module" required>
          Module
        </Label>
        <p className="text-xs text-[var(--muted-foreground)]">This project has no modules yet. A test case needs one: create the first module here.</p>
        <div className="flex gap-2">
          <Input id="tc-new-module" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Module name" />
          <Button type="button" variant="outline" disabled={!newName.trim() || addRoot.isPending} onClick={() => addRoot.mutate()}>
            Add module
          </Button>
        </div>
        {error && <p role="alert" className="text-xs text-[var(--destructive)]">{error}</p>}
      </div>
    )
  }

  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="sr-only">Module, sub-module and feature</legend>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        {levels.map((level, i) => {
          const name = MODULE_LEVELS[i] ?? `Level ${i + 1}`
          const id = `tc-module-${i}`
          return (
            <FormField
              key={`${level.parent}-${i}`}
              id={id}
              label={name}
              required={i === 0}
              error={i === 0 ? error : undefined}
            >
              {(f) => (
                <Select
                  {...f}
                  value={path[i] ?? ''}
                  onChange={(e) => onChange(e.target.value || (i > 0 ? path[i - 1] : ''))}
                >
                  <option value="">{i === 0 ? 'Select a module…' : `No ${name.toLowerCase()}`}</option>
                  {level.options.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          )
        })}
      </div>
    </fieldset>
  )
}

function TestDataField({
  value,
  asJson,
  error,
  onChange,
  onAsJson,
  onBlur,
}: {
  value: string
  asJson: boolean
  error?: string
  onChange: (v: string) => void
  onAsJson: (v: boolean) => void
  onBlur: () => void
}) {
  const json = looksLikeJson(value)
  const problem = json ? jsonProblem(value) : null
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor="tc-test-data" required>
        Test Data
      </Label>
      <Textarea
        id="tc-test-data"
        rows={4}
        className="font-mono"
        value={value}
        aria-invalid={error ? true : undefined}
        aria-describedby="tc-test-data-help"
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
      />
      <div id="tc-test-data-help" className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--muted-foreground)]">
        <span>Inputs the test uses: plain text or JSON.</span>
        {json && (
          <span className={problem ? 'text-[var(--status-warning)]' : 'text-[var(--status-good)]'}>
            {problem ? `Looks like JSON but is not valid: ${problem}` : 'Valid JSON'}
          </span>
        )}
        {json && !problem && (
          <button
            type="button"
            className="rounded-md underline underline-offset-2 hover:text-[var(--foreground)] max-md:min-h-9"
            onClick={() => {
              const pretty = prettyJson(value)
              if (pretty) onChange(pretty)
            }}
          >
            Pretty-print
          </button>
        )}
        <label className="inline-flex items-center gap-1.5 max-md:min-h-9">
          <input type="checkbox" checked={asJson} onChange={(e) => onAsJson(e.target.checked)} />
          Must be valid JSON
        </label>
      </div>
      {error && (
        <p role="alert" className="text-xs text-[var(--destructive)]">
          {error}
        </p>
      )}
    </div>
  )
}

function ExecutionDetails({ testCase }: { testCase?: TestCase }) {
  return (
    <div className="flex flex-col gap-3 text-sm">
      <p className="rounded-md bg-[var(--status-info-bg)] px-3 py-2 text-[var(--foreground)]">
        Execution happens in a test run, never on this form. Results are recorded against the run, so the test case
        definition is not overwritten when it is executed.
      </p>
      {!testCase || testCase.execution_status === 'Not Run' ? (
        <p className="text-[var(--muted-foreground)]">This test case has not been executed yet.</p>
      ) : (
        <dl className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Latest execution status</dt>
            <dd className="mt-0.5">
              <ExecutionStatusBadge status={testCase.execution_status} />
            </dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Executed by</dt>
            <dd>{testCase.last_executed_by ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Execution date</dt>
            <dd>{testCase.last_executed_at ? new Date(testCase.last_executed_at).toLocaleString() : '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-[var(--muted-foreground)]">Linked defects</dt>
            <dd>
              {testCase.linked_defects.length === 0
                ? '—'
                : testCase.linked_defects.map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && ', '}
                      <Link to={defectPath(testCase.project_id, d.id)} className="underline underline-offset-2">
                        {d.display_id ?? d.title}
                      </Link>
                    </span>
                  ))}
            </dd>
          </div>
          <div className="md:col-span-2">
            <dt className="text-xs text-[var(--muted-foreground)]">Actual result</dt>
            <dd className="whitespace-pre-wrap break-words">{testCase.last_actual_result || '—'}</dd>
          </div>
        </dl>
      )}
      {testCase && (
        <Link to={`${testCasePath(testCase.project_id, testCase.id)}?tab=executions`} className="w-fit text-sm text-[var(--link)] underline underline-offset-2">
          View execution history
        </Link>
      )}
    </div>
  )
}
