import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Settings as SettingsIcon } from 'lucide-react'

import { ApiError } from '@/api/client'
import { getSettings, getSubscription, updateSettings, type TenantSettings } from '@/api/settings'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

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
    </div>
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
  const [savedMessage, setSavedMessage] = useState(false)

  const saveMutation = useMutation({
    mutationFn: () =>
      updateSettings({ default_currency_code: currencyCode, default_timezone: timezone }),
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
