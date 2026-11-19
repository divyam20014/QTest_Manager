import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, Download, KeyRound, ShieldCheck } from 'lucide-react'

import { ApiError } from '@/api/client'
import {
  finishPlatformEnrolment,
  getPlatformSession,
  platformLogin,
  platformLogout,
  startPlatformEnrolment,
  verifyPlatformMfa,
  type PlatformEnrolStart,
  type PlatformSessionInfo,
} from '@/api/platformAdmin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormError } from '@/components/ui/form-field'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { copyText } from '@/lib/clipboard'
import { useToast } from '@/lib/toast'

import { QrCode } from './QrCode'

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

function Shell({
  title,
  subtitle,
  children,
}: {
  title: string
  subtitle: string
  children: ReactNode
}) {
  return (
    <div className="flex min-h-svh items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle className="text-base text-[var(--foreground)]">{title}</CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">{subtitle}</p>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </div>
  )
}

/** Sign-in for Platform Administration (ADR-074): password, then either
 * authenticator enrolment (first time) or a 6-digit / recovery code. The
 * password is held only while the form is on screen and is cleared on submit;
 * the resulting session lives in an HttpOnly cookie this code never reads. */
export function PlatformSignIn({
  session,
  onSession,
}: {
  session: PlatformSessionInfo | null
  onSession: (next: PlatformSessionInfo | null) => void
}) {
  if (!session) return <PasswordStep onSession={onSession} />
  // stage is 'password_ok' here (mfa_verified renders the console instead).
  return session.mfa_enrolled ? (
    <VerifyStep onSession={onSession} />
  ) : (
    <EnrolStep session={session} onSession={onSession} />
  )
}

function PasswordStep({ onSession }: { onSession: (s: PlatformSessionInfo) => void }) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const loginMutation = useMutation({
    mutationFn: async () => {
      const info = await platformLogin(email, password)
      // The session cookie is SameSite=Strict, so a browser silently drops it
      // when the page and the API are on different sites (for example the page
      // on http://127.0.0.1:5173 and the API on http://localhost:8000). Confirm
      // it was kept now, rather than failing confusingly at the code step.
      try {
        await getPlatformSession()
      } catch (err) {
        if (err instanceof ApiError && err.code === 'unauthorized') {
          throw new ApiError(
            'Your browser did not keep the sign-in cookie. Open this page on the same site as ' +
              'the API (for local development use http://localhost:5173, not 127.0.0.1).',
            'cookie_rejected',
          )
        }
        throw err
      }
      return info
    },
    onSuccess: (data) => {
      setPassword('')
      onSession(data)
    },
    onError: () => setPassword(''),
  })

  return (
    <Shell
      title="Platform Administration"
      subtitle="Separate from tenant sign-in — for provisioning and tenant lifecycle only."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          loginMutation.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-email">Email</Label>
          <Input
            id="platform-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-password">Password</Label>
          <Input
            id="platform-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        <FormError>
          {loginMutation.isError ? errorMessage(loginMutation.error, 'Sign-in failed') : null}
        </FormError>
        <Button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </Shell>
  )
}

function useCancelSignIn(onSession: (s: PlatformSessionInfo | null) => void) {
  return () => {
    void platformLogout().finally(() => onSession(null))
  }
}

function VerifyStep({ onSession }: { onSession: (s: PlatformSessionInfo | null) => void }) {
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')
  const cancel = useCancelSignIn(onSession)

  const verifyMutation = useMutation({
    mutationFn: () => verifyPlatformMfa(useRecovery ? { recovery_code: recovery } : { code }),
    onSuccess: (data) => onSession(data),
    onError: () => {
      setCode('')
      setRecovery('')
    },
  })
  const error = verifyMutation.isError
    ? errorMessage(verifyMutation.error, 'Verification failed')
    : null
  const ready = useRecovery ? recovery.replace(/[^A-Za-z0-9]/g, '').length >= 16 : code.length === 6

  return (
    <Shell
      title="Two-step verification"
      subtitle={
        useRecovery
          ? 'Enter one of your single-use recovery codes.'
          : 'Enter the 6-digit code from your authenticator app.'
      }
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready) verifyMutation.mutate()
        }}
      >
        {useRecovery ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platform-recovery">Recovery code</Label>
            <Input
              id="platform-recovery"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              autoFocus
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="font-mono"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platform-code">Authentication code</Label>
            <Input
              id="platform-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              autoFocus
              placeholder="123456"
              className="font-mono tracking-[0.3em]"
            />
          </div>
        )}
        <FormError>{error}</FormError>
        <Button type="submit" disabled={!ready || verifyMutation.isPending}>
          {verifyMutation.isPending ? 'Verifying…' : 'Verify'}
        </Button>
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <button
            type="button"
            className="min-h-11 text-left underline-offset-4 hover:underline md:min-h-0"
            onClick={() => {
              setUseRecovery((v) => !v)
              verifyMutation.reset()
            }}
          >
            {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
          </button>
          <button
            type="button"
            className="min-h-11 text-[var(--muted-foreground)] underline-offset-4 hover:underline md:min-h-0"
            onClick={cancel}
          >
            Back to sign in
          </button>
        </div>
      </form>
    </Shell>
  )
}

function EnrolStep({
  session,
  onSession,
}: {
  session: PlatformSessionInfo
  onSession: (s: PlatformSessionInfo | null) => void
}) {
  const { show: showToast } = useToast()
  const [setup, setSetup] = useState<PlatformEnrolStart | null>(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const cancel = useCancelSignIn(onSession)

  const startMutation = useMutation({
    mutationFn: startPlatformEnrolment,
    onSuccess: setSetup,
  })
  const startedRef = useRef(false)
  useEffect(() => {
    // Generate the pending secret once per visit (not on every re-render).
    if (startedRef.current) return
    startedRef.current = true
    startMutation.mutate()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const finishMutation = useMutation({
    mutationFn: () => finishPlatformEnrolment(code),
    onSuccess: (data) => setCodes(data.recovery_codes),
    onError: () => setCode(''),
  })

  if (codes) {
    return (
      <Shell
        title="Save your recovery codes"
        subtitle="Each code works once if you lose your authenticator. They are shown only now."
      >
        <div className="flex flex-col gap-4">
          <ul
            aria-label="Recovery codes"
            className="grid grid-cols-1 gap-2 rounded-md border border-[var(--border)] bg-[var(--muted)] p-3 font-mono text-sm sm:grid-cols-2"
          >
            {codes.map((c) => (
              <li key={c}>{c}</li>
            ))}
          </ul>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={async () => {
                const ok = await copyText(codes.join('\n'))
                showToast(ok ? 'success' : 'error', ok ? 'Recovery codes copied' : 'Could not copy')
              }}
            >
              <Copy aria-hidden="true" className="size-4" /> Copy
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                const blob = new Blob(
                  [
                    `QTestHub platform admin recovery codes for ${session.email}\n\n${codes.join('\n')}\n`,
                  ],
                  { type: 'text/plain' },
                )
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = 'qtesthub-platform-recovery-codes.txt'
                a.click()
                URL.revokeObjectURL(url)
              }}
            >
              <Download aria-hidden="true" className="size-4" /> Download
            </Button>
          </div>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              className="mt-1 size-5 md:size-4"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
            />
            <span>I have saved these recovery codes somewhere safe.</span>
          </label>
          <Button
            type="button"
            disabled={!saved}
            onClick={() =>
              onSession({
                ...session,
                stage: 'mfa_verified',
                mfa_enrolled: true,
              })
            }
          >
            Continue to Platform Administration
          </Button>
        </div>
      </Shell>
    )
  }

  const startError = startMutation.isError
    ? errorMessage(startMutation.error, 'Could not start setup')
    : null
  const finishError = finishMutation.isError
    ? errorMessage(finishMutation.error, 'Verification failed')
    : null

  return (
    <Shell
      title="Set up two-step verification"
      subtitle="Platform Administration requires an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…)."
    >
      <div className="flex flex-col gap-4">
        <FormError>{startError}</FormError>
        {setup ? (
          <>
            <ol className="list-decimal space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
              <li>Scan this QR code with your authenticator app, or type the key below.</li>
              <li>Enter the 6-digit code it shows to finish.</li>
            </ol>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <QrCode value={setup.otpauth_uri} label="QR code for your authenticator app" />
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <Label htmlFor="platform-secret">Setup key (manual entry)</Label>
                <div className="flex gap-2">
                  <Input
                    id="platform-secret"
                    readOnly
                    value={setup.secret.replace(/(.{4})/g, '$1 ').trim()}
                    className="font-mono text-xs"
                    onFocus={(e) => e.currentTarget.select()}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    aria-label="Copy setup key"
                    onClick={async () => {
                      const ok = await copyText(setup.secret)
                      showToast(
                        ok ? 'success' : 'error',
                        ok ? 'Setup key copied' : 'Could not copy',
                      )
                    }}
                  >
                    <KeyRound aria-hidden="true" className="size-4" />
                  </Button>
                </div>
                <p className="text-xs text-[var(--muted-foreground)]">
                  Account: {setup.account} · Time-based, 6 digits, 30 s
                </p>
              </div>
            </div>
            <form
              className="flex flex-col gap-3"
              onSubmit={(e) => {
                e.preventDefault()
                if (code.length === 6) finishMutation.mutate()
              }}
            >
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="platform-enrol-code">Authentication code</Label>
                <Input
                  id="platform-enrol-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  inputMode="numeric"
                  pattern="[0-9]*"
                  maxLength={6}
                  autoComplete="one-time-code"
                  placeholder="123456"
                  className="font-mono tracking-[0.3em]"
                />
              </div>
              <FormError>{finishError}</FormError>
              <Button type="submit" disabled={code.length !== 6 || finishMutation.isPending}>
                <ShieldCheck aria-hidden="true" className="size-4" />
                {finishMutation.isPending ? 'Verifying…' : 'Verify and enable'}
              </Button>
            </form>
          </>
        ) : (
          !startError && (
            <p role="status" className="text-sm text-[var(--muted-foreground)]">
              Preparing your setup key…
            </p>
          )
        )}
        <button
          type="button"
          className="min-h-11 self-start text-sm text-[var(--muted-foreground)] underline-offset-4 hover:underline md:min-h-0"
          onClick={cancel}
        >
          Back to sign in
        </button>
      </div>
    </Shell>
  )
}
