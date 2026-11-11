import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings as SettingsIcon } from 'lucide-react'

import { downloadExport, getExportJob, requestExport } from '@/api/export'
import {
  createCustomFieldDefinition,
  createFieldOption,
  deleteCustomFieldDefinition,
  deleteFieldOption,
  listCustomFieldDefinitions,
  listFieldOptions,
  listStatusLabels,
  setStatusLabel,
  type CustomFieldEntityType,
  type CustomFieldType,
  type FieldKey,
} from '@/api/fieldCustomization'
import { createScimToken, listScimTokens, revokeScimToken } from '@/api/scim'
import { createServiceToken, listServiceTokens, revokeServiceToken } from '@/api/serviceTokens'
import { ApiError } from '@/api/client'
import {
  getBranding,
  getLogoUrl,
  getSettings,
  getSubscription,
  updateBranding,
  updateSettings,
  uploadLogo,
  type TenantBranding,
  type TenantSettings,
} from '@/api/settings'
import { getSsoConfig, updateSsoConfig } from '@/api/sso'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'

// Phase 1 (AI/SaaS vision roadmap): the tenant self-service settings
// mechanism (GAP-80 / SAAS-GAP-7), extended in Phase 3 (ADR-045) with the
// AI Test Case Generator's enable/disable toggle and API key. Future
// phases (notification preferences, branding) add their own fields here
// once each is separately approved.
export function Settings() {
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const forbidden = settingsQuery.error instanceof ApiError && settingsQuery.error.code === 'forbidden'

  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
        </CardHeader>
        <CardContent>
          {forbidden ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center">
              <SettingsIcon className="size-8 text-[var(--muted-foreground)]" />
              <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
                Only an Administrator can view or change organization settings.
              </p>
            </div>
          ) : settingsQuery.isLoading || !settingsQuery.data ? (
            <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
          ) : (
            <SettingsForm initial={settingsQuery.data} />
          )}
        </CardContent>
      </Card>
      <AISettingsCard />
      <SubscriptionCard />
      <BrandingCard />
      <FieldOptionsCard fieldKey="defect_severity" title="Defect Severities" />
      <FieldOptionsCard fieldKey="test_case_priority" title="Test Case Priorities" />
      <StatusLabelsCard entityType="defect" title="Defect Status Labels" />
      <StatusLabelsCard entityType="test_case" title="Test Case Status Labels" />
      <CustomFieldsCard entityType="test_case" title="Test Case Custom Fields" />
      <CustomFieldsCard entityType="defect" title="Defect Custom Fields" />
      <CustomFieldsCard entityType="requirement" title="Requirement Custom Fields" />
      <SsoCard />
      <ScimTokensCard />
      <ServiceTokensCard />
      <ExportCard />
    </div>
  )
}

// Tier 5 / ADR-055: severity/priority are tenant-configurable value sets
// (not a fixed enum any more) -- status, by contrast, gets only the
// display-label overlay below, never a value-set conversion.
function FieldOptionsCard({ fieldKey, title }: { fieldKey: FieldKey; title: string }) {
  const queryClient = useQueryClient()
  const optionsQuery = useQuery({
    queryKey: ['field-options', fieldKey],
    queryFn: () => listFieldOptions(fieldKey),
  })
  const forbidden = optionsQuery.error instanceof ApiError && optionsQuery.error.code === 'forbidden'
  const [code, setCode] = useState('')

  const createMutation = useMutation({
    mutationFn: () => createFieldOption({ field_key: fieldKey, code, label: code }),
    onSuccess: () => {
      setCode('')
      queryClient.invalidateQueries({ queryKey: ['field-options', fieldKey] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteFieldOption,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['field-options', fieldKey] }),
  })

  if (forbidden) return null

  const serverError =
    (createMutation.error ?? deleteMutation.error) instanceof ApiError
      ? ((createMutation.error ?? deleteMutation.error) as ApiError).message
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1.5">
            {optionsQuery.data?.map((option) => (
              <li
                key={option.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
              >
                <span>{option.label}</span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(option.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex items-center gap-2">
            <Input
              placeholder="New option name"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={!code || createMutation.isPending}
              onClick={() => createMutation.mutate()}
            >
              Add
            </Button>
          </div>
          {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
        </div>
      </CardContent>
    </Card>
  )
}

// Tier 5 / ADR-055: additive display-label overlay only -- the fixed
// status codes and their transition logic are never touched here.
function StatusLabelsCard({
  entityType,
  title,
}: {
  entityType: 'test_case' | 'defect'
  title: string
}) {
  const queryClient = useQueryClient()
  const labelsQuery = useQuery({
    queryKey: ['status-labels', entityType],
    queryFn: () => listStatusLabels(entityType),
  })
  const forbidden = labelsQuery.error instanceof ApiError && labelsQuery.error.code === 'forbidden'
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const saveMutation = useMutation({
    mutationFn: (statusCode: string) => setStatusLabel(entityType, statusCode, drafts[statusCode] ?? null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['status-labels', entityType] }),
  })

  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-2 text-sm">
          {labelsQuery.data?.map((entry) => (
            <div key={entry.status_code} className="flex items-center gap-2">
              <span className="w-32 shrink-0 text-xs text-[var(--muted-foreground)]">
                {entry.status_code}
              </span>
              <Input
                value={drafts[entry.status_code] ?? entry.label}
                onChange={(e) =>
                  setDrafts((prev) => ({ ...prev, [entry.status_code]: e.target.value }))
                }
              />
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={saveMutation.isPending}
                onClick={() => saveMutation.mutate(entry.status_code)}
              >
                Save
              </Button>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

const CUSTOM_FIELD_TYPES: CustomFieldType[] = [
  'text',
  'number',
  'boolean',
  'date',
  'select',
  'multi_select',
]

// Tier 5 / ADR-055: tenant-defined custom fields. Values are read inline
// on the owning entity's own GET response and written through a dedicated
// endpoint -- there is no value-editing UI here, only field definitions.
function CustomFieldsCard({
  entityType,
  title,
}: {
  entityType: CustomFieldEntityType
  title: string
}) {
  const queryClient = useQueryClient()
  const definitionsQuery = useQuery({
    queryKey: ['custom-field-definitions', entityType],
    queryFn: () => listCustomFieldDefinitions(entityType),
  })
  const forbidden =
    definitionsQuery.error instanceof ApiError && definitionsQuery.error.code === 'forbidden'

  const [fieldKey, setFieldKey] = useState('')
  const [label, setLabel] = useState('')
  const [fieldType, setFieldType] = useState<CustomFieldType>('text')
  const [optionsText, setOptionsText] = useState('')

  const createMutation = useMutation({
    mutationFn: () =>
      createCustomFieldDefinition({
        entity_type: entityType,
        field_key: fieldKey,
        label,
        field_type: fieldType,
        options:
          fieldType === 'select' || fieldType === 'multi_select'
            ? optionsText
                .split(',')
                .map((o) => o.trim())
                .filter(Boolean)
            : undefined,
      }),
    onSuccess: () => {
      setFieldKey('')
      setLabel('')
      setOptionsText('')
      queryClient.invalidateQueries({ queryKey: ['custom-field-definitions', entityType] })
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteCustomFieldDefinition,
    onSuccess: () =>
      queryClient.invalidateQueries({ queryKey: ['custom-field-definitions', entityType] }),
  })

  if (forbidden) return null

  const serverError =
    (createMutation.error ?? deleteMutation.error) instanceof ApiError
      ? ((createMutation.error ?? deleteMutation.error) as ApiError).message
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md flex-col gap-3 text-sm">
          <ul className="flex flex-col gap-1.5">
            {definitionsQuery.data?.map((def) => (
              <li
                key={def.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
              >
                <span>
                  {def.label} <span className="text-xs text-[var(--muted-foreground)]">({def.field_type}{def.required ? ', required' : ''})</span>
                </span>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={deleteMutation.isPending}
                  onClick={() => deleteMutation.mutate(def.id)}
                >
                  Remove
                </Button>
              </li>
            ))}
          </ul>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${entityType}-field-key`}>Field Key (lowercase, no spaces)</Label>
            <Input
              id={`${entityType}-field-key`}
              value={fieldKey}
              onChange={(e) => setFieldKey(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${entityType}-field-label`}>Label</Label>
            <Input
              id={`${entityType}-field-label`}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${entityType}-field-type`}>Type</Label>
            <select
              id={`${entityType}-field-type`}
              className="rounded border border-[var(--border)] bg-transparent px-2 py-1.5 text-sm"
              value={fieldType}
              onChange={(e) => setFieldType(e.target.value as CustomFieldType)}
            >
              {CUSTOM_FIELD_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          </div>
          {(fieldType === 'select' || fieldType === 'multi_select') && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor={`${entityType}-field-options`}>Options (comma-separated)</Label>
              <Input
                id={`${entityType}-field-options`}
                value={optionsText}
                onChange={(e) => setOptionsText(e.target.value)}
              />
            </div>
          )}
          {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
          <Button
            type="button"
            size="sm"
            disabled={!fieldKey || !label || createMutation.isPending}
            onClick={() => createMutation.mutate()}
          >
            Add Field
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}

// Tier 1 / ADR-053: read-only -- assignment is platform-admin-only
// (schema/admin-assignment only, no payment gateway).
const SUBSCRIPTION_STATUS_TONE = {
  trialing: 'neutral',
  active: 'positive',
  past_due: 'critical',
  canceled: 'critical',
} as const

function SubscriptionCard() {
  const subscriptionQuery = useQuery({ queryKey: ['subscription'], queryFn: getSubscription })
  const forbidden =
    subscriptionQuery.error instanceof ApiError && subscriptionQuery.error.code === 'forbidden'

  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Subscription</CardTitle>
      </CardHeader>
      <CardContent>
        {subscriptionQuery.isLoading || !subscriptionQuery.data ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : (
          <div className="flex max-w-sm flex-col gap-2 text-sm">
            <div className="flex items-center gap-2">
              <span className="font-medium">{subscriptionQuery.data.plan.name}</span>
              <Badge tone={SUBSCRIPTION_STATUS_TONE[subscriptionQuery.data.status]}>
                {subscriptionQuery.data.status}
              </Badge>
            </div>
            <p className="text-xs text-[var(--muted-foreground)]">
              Seats: {subscriptionQuery.data.seat_count}
              {subscriptionQuery.data.plan.seat_limit !== null &&
                ` / ${subscriptionQuery.data.plan.seat_limit}`}
            </p>
            {subscriptionQuery.data.current_period_end && (
              <p className="text-xs text-[var(--muted-foreground)]">
                Current period ends{' '}
                {new Date(subscriptionQuery.data.current_period_end).toLocaleDateString()}
              </p>
            )}
            <p className="text-xs text-[var(--muted-foreground)]">
              To change your plan, contact your QTestHub account representative.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SettingsForm({ initial }: { initial: TenantSettings }) {
  const queryClient = useQueryClient()
  const [currencyCode, setCurrencyCode] = useState(initial.default_currency_code)
  const [timezone, setTimezone] = useState(initial.default_timezone)
  const [allowlistText, setAllowlistText] = useState(initial.ip_allowlist.join('\n'))
  const [savedMessage, setSavedMessage] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSettings({
        default_currency_code: currencyCode,
        default_timezone: timezone,
        ip_allowlist: allowlistText
          .split('\n')
          .map((line) => line.trim())
          .filter(Boolean),
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
      setSavedMessage(true)
      setTimeout(() => setSavedMessage(false), 3000)
    },
  })

  const serverError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  return (
    <form
      className="flex max-w-sm flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        setSavedMessage(false)
        saveMutation.mutate()
      }}
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-currency">Default Currency Code</Label>
        <Input
          id="default-currency"
          value={currencyCode}
          maxLength={3}
          onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
        />
        <p className="text-xs text-[var(--muted-foreground)]">
          3-letter ISO 4217 code (e.g. USD, GBP, EUR). Used as the default when a new project
          doesn't specify its own currency.
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="default-timezone">Default Timezone</Label>
        <Input id="default-timezone" value={timezone} onChange={(e) => setTimezone(e.target.value)} />
        <p className="text-xs text-[var(--muted-foreground)]">
          IANA timezone name (e.g. UTC, Europe/London, Asia/Kolkata).
        </p>
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="ip-allowlist">IP Allowlist (PV-11.3)</Label>
        <Textarea
          id="ip-allowlist"
          rows={3}
          placeholder={'One IP or CIDR block per line, e.g.\n203.0.113.0/24'}
          value={allowlistText}
          onChange={(e) => setAllowlistText(e.target.value)}
        />
        <p className="text-xs text-[var(--muted-foreground)]">
          Leave empty for no restriction. <strong>Caution:</strong> if you set this, make sure your
          own current network is included — there is no backdoor recovery path except via your
          platform administrator.
        </p>
      </div>
      {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save Changes'}
        </Button>
        {savedMessage && <span className="text-xs text-[var(--status-good)]">Saved.</span>}
      </div>
    </form>
  )
}

// Phase 3 (AI/SaaS vision roadmap): tenant-level AI enable/disable + the
// Gemini API key, reusing this same settings mechanism rather than a
// second one. The key is write-only -- the server never returns it, only
// whether one is configured.
export function AISettingsCard() {
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: getSettings })
  const forbidden = settingsQuery.error instanceof ApiError && settingsQuery.error.code === 'forbidden'

  if (forbidden || settingsQuery.isLoading || !settingsQuery.data) {
    return null
  }

  return <AISettingsForm initial={settingsQuery.data} />
}

function AISettingsForm({ initial }: { initial: TenantSettings }) {
  const queryClient = useQueryClient()
  const [apiKeyInput, setApiKeyInput] = useState('')
  const [savedMessage, setSavedMessage] = useState(false)

  const saveMutation = useMutation({
    mutationFn: (req: { ai_enabled?: boolean; ai_api_key?: string }) => updateSettings(req),
    onSuccess: (data) => {
      queryClient.setQueryData(['settings'], data)
      setApiKeyInput('')
      setSavedMessage(true)
      setTimeout(() => setSavedMessage(false), 3000)
    },
  })

  const serverError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>AI Test Case Generator</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">
            Provider: <span className="font-medium">{initial.ai_provider}</span>. Lets a project
            member generate draft test cases from a requirement — every generated case is created
            as a normal draft that still needs human review and approval before it counts for
            anything.
          </p>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="ai-api-key">Gemini API Key</Label>
            <Input
              id="ai-api-key"
              type="password"
              placeholder={initial.ai_api_key_configured ? 'Configured — enter a new key to replace' : 'Not configured'}
              value={apiKeyInput}
              onChange={(e) => setApiKeyInput(e.target.value)}
            />
            <div className="flex items-center gap-2">
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={!apiKeyInput || saveMutation.isPending}
                onClick={() => saveMutation.mutate({ ai_api_key: apiKeyInput })}
              >
                Save Key
              </Button>
              {initial.ai_api_key_configured && (
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  disabled={saveMutation.isPending}
                  onClick={() => saveMutation.mutate({ ai_api_key: '' })}
                >
                  Clear Key
                </Button>
              )}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <Button
              type="button"
              size="sm"
              disabled={saveMutation.isPending}
              onClick={() => saveMutation.mutate({ ai_enabled: !initial.ai_enabled })}
            >
              {initial.ai_enabled ? 'Disable AI Generation' : 'Enable AI Generation'}
            </Button>
            <span className="text-xs text-[var(--muted-foreground)]">
              Currently {initial.ai_enabled ? 'enabled' : 'disabled'}.
            </span>
          </div>
          {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
          {savedMessage && <span className="text-xs text-[var(--status-good)]">Saved.</span>}
        </div>
      </CardContent>
    </Card>
  )
}

// Tier 4 / ADR-054: tenant branding (PV-11.4) -- reuses this same
// settings mechanism and Tier 1's storage abstraction for the logo.
function BrandingCard() {
  const brandingQuery = useQuery({ queryKey: ['branding'], queryFn: getBranding })
  const forbidden = brandingQuery.error instanceof ApiError && brandingQuery.error.code === 'forbidden'
  if (forbidden || brandingQuery.isLoading || !brandingQuery.data) return null
  return <BrandingForm initial={brandingQuery.data} />
}

function BrandingForm({ initial }: { initial: TenantBranding }) {
  const queryClient = useQueryClient()
  const [displayName, setDisplayName] = useState(initial.display_name ?? '')
  const [primaryColor, setPrimaryColor] = useState(initial.primary_color ?? '')
  const [savedMessage, setSavedMessage] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () => updateBranding({ display_name: displayName, primary_color: primaryColor }),
    onSuccess: (data) => {
      queryClient.setQueryData(['branding'], data)
      setSavedMessage(true)
      setTimeout(() => setSavedMessage(false), 3000)
    },
  })

  const logoMutation = useMutation({
    mutationFn: (file: File) => uploadLogo(file),
    onSuccess: (data) => queryClient.setQueryData(['branding'], data),
  })

  const serverError =
    (saveMutation.error ?? logoMutation.error) instanceof ApiError
      ? ((saveMutation.error ?? logoMutation.error) as ApiError).message
      : null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Branding</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-3 text-sm">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-name">Display Name</Label>
            <Input id="brand-name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-color">Primary Color</Label>
            <Input
              id="brand-color"
              type="color"
              className="h-9 w-16 p-1"
              value={primaryColor || '#1a2b3c'}
              onChange={(e) => setPrimaryColor(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="brand-logo">Logo</Label>
            {initial.has_logo && (
              <img src={getLogoUrl()} alt="Organization logo" className="h-10 w-auto" />
            )}
            <input
              id="brand-logo"
              type="file"
              accept="image/png,image/jpeg,image/svg+xml,image/webp"
              onChange={(e) => {
                const file = e.target.files?.[0]
                if (file) logoMutation.mutate(file)
              }}
            />
          </div>
          {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
          <div className="flex items-center gap-3">
            <Button type="button" size="sm" disabled={saveMutation.isPending} onClick={() => saveMutation.mutate()}>
              {saveMutation.isPending ? 'Saving…' : 'Save Branding'}
            </Button>
            {savedMessage && <span className="text-xs text-[var(--status-good)]">Saved.</span>}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Tier 4 / ADR-054: tenant SSO (OIDC) configuration (PV-11.1). SAML is
// deliberately out of scope -- see ADR-054.
function SsoCard() {
  const ssoQuery = useQuery({ queryKey: ['sso-config'], queryFn: getSsoConfig })
  const forbidden = ssoQuery.error instanceof ApiError && ssoQuery.error.code === 'forbidden'
  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Single Sign-On (OIDC)</CardTitle>
      </CardHeader>
      <CardContent>
        {ssoQuery.isLoading || !ssoQuery.data ? (
          <p className="text-sm text-[var(--muted-foreground)]">Loading…</p>
        ) : (
          <SsoForm initial={ssoQuery.data} />
        )}
      </CardContent>
    </Card>
  )
}

function SsoForm({
  initial,
}: {
  initial: { enabled: boolean; issuer: string | null; client_id: string | null; default_role_code: string }
}) {
  const queryClient = useQueryClient()
  const [enabled, setEnabled] = useState(initial.enabled)
  const [issuer, setIssuer] = useState(initial.issuer ?? '')
  const [clientId, setClientId] = useState(initial.client_id ?? '')
  const [clientSecret, setClientSecret] = useState('')
  const [defaultRole, setDefaultRole] = useState(initial.default_role_code)
  const [savedMessage, setSavedMessage] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSsoConfig({
        enabled,
        issuer,
        client_id: clientId,
        client_secret: clientSecret || undefined,
        default_role_code: defaultRole,
      }),
    onSuccess: (data) => {
      queryClient.setQueryData(['sso-config'], data)
      setClientSecret('')
      setSavedMessage(true)
      setTimeout(() => setSavedMessage(false), 3000)
    },
  })

  const serverError = saveMutation.error instanceof ApiError ? saveMutation.error.message : null

  return (
    <form
      className="flex max-w-sm flex-col gap-3 text-sm"
      onSubmit={(e) => {
        e.preventDefault()
        saveMutation.mutate()
      }}
    >
      <p className="text-xs text-[var(--muted-foreground)]">
        OIDC only (SAML is not yet supported). A successful SSO login does not require this app's
        own MFA code — the identity provider is treated as the trust anchor.
      </p>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sso-issuer">Issuer URL</Label>
        <Input
          id="sso-issuer"
          value={issuer}
          placeholder="https://idp.example.com"
          onChange={(e) => setIssuer(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sso-client-id">Client ID</Label>
        <Input id="sso-client-id" value={clientId} onChange={(e) => setClientId(e.target.value)} />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sso-client-secret">Client Secret</Label>
        <Input
          id="sso-client-secret"
          type="password"
          placeholder={initial.client_id ? 'Configured — enter a new value to replace' : 'Not configured'}
          value={clientSecret}
          onChange={(e) => setClientSecret(e.target.value)}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="sso-default-role">Default Role for New SSO Users</Label>
        <Input id="sso-default-role" value={defaultRole} onChange={(e) => setDefaultRole(e.target.value)} />
      </div>
      {serverError && <p className="text-xs text-[var(--destructive)]">{serverError}</p>}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          size="sm"
          variant={enabled ? 'outline' : 'default'}
          onClick={() => setEnabled((v) => !v)}
        >
          {enabled ? 'Enabled — click to disable' : 'Disabled — click to enable'}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <Button type="submit" size="sm" disabled={saveMutation.isPending}>
          {saveMutation.isPending ? 'Saving…' : 'Save SSO Settings'}
        </Button>
        {savedMessage && <span className="text-xs text-[var(--status-good)]">Saved.</span>}
      </div>
    </form>
  )
}

// Tier 4 / ADR-054: SCIM 2.0 provisioning (PV-11.2) -- Users only, token
// management. **Validated against the SCIM spec's own shapes in tests,
// not a real IdP's SCIM client** -- see ADR-054.
function ScimTokensCard() {
  const queryClient = useQueryClient()
  const tokensQuery = useQuery({ queryKey: ['scim-tokens'], queryFn: listScimTokens })
  const forbidden = tokensQuery.error instanceof ApiError && tokensQuery.error.code === 'forbidden'
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: createScimToken,
    onSuccess: (data) => {
      setJustCreated(data.token)
      queryClient.invalidateQueries({ queryKey: ['scim-tokens'] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeScimToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['scim-tokens'] }),
  })

  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>SCIM Provisioning</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">
            Lets an identity provider create, update, and deactivate users automatically. Point
            your IdP's SCIM client at this tenant's SCIM base URL with one of the bearer tokens
            below.
          </p>
          {justCreated && (
            <div className="rounded border border-[var(--border)] bg-[var(--muted)] p-2">
              <p className="text-xs text-[var(--muted-foreground)]">
                Copy this token now — it will not be shown again:
              </p>
              <p className="break-all font-mono text-xs">{justCreated}</p>
            </div>
          )}
          <Button type="button" size="sm" disabled={createMutation.isPending} onClick={() => createMutation.mutate()}>
            {createMutation.isPending ? 'Creating…' : 'Create New Token'}
          </Button>
          <ul className="flex flex-col gap-2">
            {tokensQuery.data?.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
              >
                <span className="text-xs text-[var(--muted-foreground)]">
                  Created {new Date(token.created_at).toLocaleDateString()}
                  {token.revoked_at && ' — revoked'}
                </span>
                {!token.revoked_at && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(token.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

// Post-gap-closure pass / ADR-059: machine-to-machine auth plane for
// CI/CD result ingestion (PV-5, GAP-73) -- a third, deliberately narrow
// auth plane alongside the session cookie and platform-admin Basic auth.
// Mirrors ScimTokensCard above exactly, plus a name field and visible
// scope (only "ci_results" exists today).
function ServiceTokensCard() {
  const queryClient = useQueryClient()
  const tokensQuery = useQuery({ queryKey: ['service-tokens'], queryFn: listServiceTokens })
  const forbidden = tokensQuery.error instanceof ApiError && tokensQuery.error.code === 'forbidden'
  const [name, setName] = useState('')
  const [justCreated, setJustCreated] = useState<string | null>(null)

  const createMutation = useMutation({
    mutationFn: () => createServiceToken(name),
    onSuccess: (data) => {
      setJustCreated(data.raw_value)
      setName('')
      queryClient.invalidateQueries({ queryKey: ['service-tokens'] })
    },
  })

  const revokeMutation = useMutation({
    mutationFn: revokeServiceToken,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['service-tokens'] }),
  })

  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>CI/CD Integration Tokens</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-md flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">
            Lets a CI job report test results directly into this tenant's test runs, authenticated
            by a bearer token scoped to result ingestion only.
          </p>
          {justCreated && (
            <div className="rounded border border-[var(--border)] bg-[var(--muted)] p-2">
              <p className="text-xs text-[var(--muted-foreground)]">
                Copy this token now — it will not be shown again:
              </p>
              <p className="break-all font-mono text-xs">{justCreated}</p>
            </div>
          )}
          <div className="flex gap-2">
            <Input
              placeholder="Token name (e.g. GitHub Actions)"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <Button
              type="button"
              size="sm"
              disabled={createMutation.isPending || !name.trim()}
              onClick={() => createMutation.mutate()}
            >
              {createMutation.isPending ? 'Creating…' : 'Create Token'}
            </Button>
          </div>
          <ul className="flex flex-col gap-2">
            {tokensQuery.data?.map((token) => (
              <li
                key={token.id}
                className="flex items-center justify-between rounded border border-[var(--border)] px-2 py-1"
              >
                <span className="text-xs text-[var(--muted-foreground)]">
                  {token.name} — created {new Date(token.created_at).toLocaleDateString()}
                  {token.revoked_at && ' — revoked'}
                </span>
                {!token.revoked_at && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={revokeMutation.isPending}
                    onClick={() => revokeMutation.mutate(token.id)}
                  >
                    Revoke
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </div>
      </CardContent>
    </Card>
  )
}

// Tier 4 / ADR-054: tenant-wide data export (PV-11.5), distinct from the
// existing per-user GDPR-erase action. Runs through Tier 1's background
// job queue rather than blocking the request.
function ExportCard() {
  const [jobId, setJobId] = useState<string | null>(null)

  const requestMutation = useMutation({
    mutationFn: requestExport,
    onSuccess: (data) => setJobId(data.job_id),
  })

  const jobQuery = useQuery({
    queryKey: ['export-job', jobId],
    queryFn: () => getExportJob(jobId as string),
    enabled: jobId !== null,
    refetchInterval: (query) =>
      query.state.data?.status === 'queued' || query.state.data?.status === 'running' ? 1500 : false,
  })

  const forbidden = requestMutation.error instanceof ApiError && requestMutation.error.code === 'forbidden'
  if (forbidden) return null

  return (
    <Card>
      <CardHeader>
        <CardTitle>Export Organization Data</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex max-w-sm flex-col gap-3 text-sm">
          <p className="text-xs text-[var(--muted-foreground)]">
            Generates a downloadable archive of everything this organization owns — test cases,
            defects, requirements, and more. Attachment files are listed by reference, not
            included as bytes.
          </p>
          <Button type="button" size="sm" disabled={requestMutation.isPending} onClick={() => requestMutation.mutate()}>
            {requestMutation.isPending ? 'Requesting…' : 'Request Export'}
          </Button>
          {jobQuery.data && (
            <div className="flex items-center gap-2">
              <Badge
                tone={
                  jobQuery.data.status === 'succeeded'
                    ? 'positive'
                    : jobQuery.data.status === 'failed'
                      ? 'critical'
                      : 'neutral'
                }
              >
                {jobQuery.data.status}
              </Badge>
              {jobQuery.data.status === 'succeeded' && (
                <Button type="button" size="sm" variant="outline" onClick={() => downloadExport(jobQuery.data!.id)}>
                  Download
                </Button>
              )}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
