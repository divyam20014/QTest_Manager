import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useMutation } from '@tanstack/react-query'
import { Copy, Download, KeyRound, ShieldCheck } from 'lucide-react'

import { ApiError } from '@/api/client'
import {
  finishPlatformEnrolment,
  getPlatformSession,
  platformLogin,
  platformLogout,
  resetPlatformPassword,
  startPlatformEnrolment,
  verifyPlatformMfa,
  type PlatformEnrolStart,
  type PlatformSessionInfo,
} from '@/api/platformAdmin'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { FormError } from '@/components/ui/form-field'
import { PasswordInput, PasswordStrengthMeter } from '@/components/ui/password-input'
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
  const mainRef = useRef<HTMLElement>(null)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // A step change replaces the controls that had focus, which drops it to
  // <body> (a screen reader user is then lost). Move it to the new step's
  // heading -- unless the step already put focus on one of its own fields.
  useEffect(() => {
    const active = document.activeElement
    if (!active || active === document.body || !mainRef.current?.contains(active)) {
      headingRef.current?.focus()
    }
  }, [title])
  return (
    <main
      ref={mainRef}
      id="main-content"
      className="flex min-h-svh items-center justify-center p-4 pb-[calc(1rem+env(safe-area-inset-bottom))]"
    >
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle
            as="h1"
            ref={headingRef}
            tabIndex={-1}
            className="text-base text-[var(--foreground)] outline-none"
          >
            {title}
          </CardTitle>
          <p className="text-sm text-[var(--muted-foreground)]">{subtitle}</p>
        </CardHeader>
        <CardContent>{children}</CardContent>
      </Card>
    </main>
  )
}

/** Sign-in for Platform Administration (ADR-074): password, then either
 * authenticator enrolment (first time) or a 6-digit / recovery code. The
 * password is held only while the form is on screen and is cleared on submit;
 * the resulting session lives in an HttpOnly cookie this code never reads. */
export function PlatformSignIn({
  session,
  onSession,
  initialNotice = null,
}: {
  session: PlatformSessionInfo | null
  onSession: (next: PlatformSessionInfo | null) => void
  /** e.g. the idle-timeout message after the session expired (ADR-083). */
  initialNotice?: string | null
}) {
  const [mode, setMode] = useState<'signin' | 'reset'>('signin')
  const [notice, setNotice] = useState<string | null>(initialNotice)
  if (!session) {
    return mode === 'reset' ? (
      <ResetStep
        onBack={() => setMode('signin')}
        onDone={() => {
          setNotice('Password updated. Sign in with your new password.')
          setMode('signin')
        }}
      />
    ) : (
      <PasswordStep
        onSession={onSession}
        notice={notice}
        onHaveResetCode={() => {
          setNotice(null)
          setMode('reset')
        }}
      />
    )
  }
  // stage is 'password_ok' here (mfa_verified renders the console instead).
  return session.mfa_enrolled ? (
    <VerifyStep onSession={onSession} />
  ) : (
    <EnrolStep session={session} onSession={onSession} />
  )
}

function PasswordStep({
  onSession,
  notice,
  onHaveResetCode,
}: {
  onSession: (s: PlatformSessionInfo) => void
  notice: string | null
  onHaveResetCode: () => void
}) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const loginMutation = useMutation({
    mutationFn: async () => {
      const info = await platformLogin(email, password)
      // The session cookie is SameSite=Strict, so a browser silently drops it
      // when the page and the API are on different sites (for example the page
      // on a network IP and the API on localhost). Confirm it was kept now,
      // rather than failing confusingly at the code step.
      try {
        await getPlatformSession()
      } catch (err) {
        if (err instanceof ApiError && err.code === 'unauthorized') {
          throw new ApiError(
            'Your browser did not keep the sign-in cookie. Open this page on the same site as ' +
              'the API (for local development use http://localhost:5173 or http://127.0.0.1:5173).',
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
          <PasswordInput
            id="platform-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
        </div>
        {notice && (
          <p role="status" className="text-sm text-[var(--foreground)]">
            {notice}
          </p>
        )}
        <FormError>
          {loginMutation.isError ? errorMessage(loginMutation.error, 'Sign-in failed') : null}
        </FormError>
        <Button type="submit" disabled={loginMutation.isPending}>
          {loginMutation.isPending ? 'Signing in…' : 'Sign in'}
        </Button>
        <button
          type="button"
          className="min-h-11 self-start text-sm text-[var(--muted-foreground)] underline-offset-4 hover:underline md:min-h-0"
          onClick={onHaveResetCode}
        >
          Have a reset code?
        </button>
      </form>
    </Shell>
  )
}

/** ADR-081: finish an admin-initiated password reset. Needs the one-time reset
 * code, a new password and (when the account has MFA) an authenticator or
 * recovery code. Nothing here is stored; it signs nobody in, the person signs in
 * normally afterwards. */
function ResetStep({ onBack, onDone }: { onBack: () => void; onDone: () => void }) {
  const [email, setEmail] = useState('')
  const [resetCode, setResetCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [code, setCode] = useState('')
  const [recovery, setRecovery] = useState('')

  const mismatch = confirm.length > 0 && password !== confirm
  const resetMutation = useMutation({
    mutationFn: () =>
      resetPlatformPassword({
        email,
        resetCode: resetCode.trim(),
        newPassword: password,
        factor: useRecovery
          ? recovery.trim()
            ? { recovery_code: recovery }
            : null
          : code
            ? { code }
            : null,
      }),
    onSuccess: () => {
      setPassword('')
      setConfirm('')
      onDone()
    },
    onError: () => {
      setCode('')
      setRecovery('')
    },
  })
  const ready =
    email.length > 2 &&
    resetCode.replace(/[^A-Za-z0-9]/g, '').length >= 8 &&
    password.length > 0 &&
    password === confirm

  return (
    <Shell
      title="Reset your password"
      subtitle="Use the one-time reset code another platform admin gave you, then choose a new password."
    >
      <form
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault()
          if (ready && !resetMutation.isPending) resetMutation.mutate()
        }}
      >
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-reset-email">Email</Label>
          <Input
            id="platform-reset-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            className="min-h-11 md:min-h-0"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-reset-code">Reset code</Label>
          <Input
            id="platform-reset-code"
            value={resetCode}
            onChange={(e) => setResetCode(e.target.value)}
            autoComplete="off"
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
            placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
            className="min-h-11 font-mono md:min-h-0"
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-reset-password">New password</Label>
          <PasswordInput
            id="platform-reset-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="new-password"
            aria-describedby="platform-reset-password-hint"
            className="min-h-11 md:min-h-0"
          />
          <p id="platform-reset-password-hint" className="text-xs text-[var(--muted-foreground)]">
            At least 12 characters with an uppercase letter, a lowercase letter and a digit.
          </p>
<PasswordStrengthMeter value={password} />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="platform-reset-confirm">Confirm new password</Label>
          <PasswordInput
            id="platform-reset-confirm"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            autoComplete="new-password"
            aria-invalid={mismatch}
            aria-describedby={mismatch ? 'platform-reset-confirm-error' : undefined}
            className="min-h-11 md:min-h-0"
          />
          {mismatch && (
            <p
              id="platform-reset-confirm-error"
              role="alert"
              className="text-xs text-[var(--destructive)]"
            >
              The two new passwords do not match
            </p>
          )}
        </div>
        {useRecovery ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platform-reset-recovery">Recovery code (if you have set up MFA)</Label>
            <Input
              id="platform-reset-recovery"
              value={recovery}
              onChange={(e) => setRecovery(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              spellCheck={false}
              placeholder="XXXX-XXXX-XXXX-XXXX"
              className="min-h-11 font-mono md:min-h-0"
            />
          </div>
        ) : (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platform-reset-auth-code">
              Authentication code (if you have set up MFA)
            </Label>
            <Input
              id="platform-reset-auth-code"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              pattern="[0-9]*"
              maxLength={6}
              autoComplete="one-time-code"
              placeholder="123456"
              className="min-h-11 font-mono tracking-[0.3em] md:min-h-0"
            />
          </div>
        )}
        <button
          type="button"
          className="min-h-11 self-start text-left text-sm underline-offset-4 hover:underline md:min-h-0"
          onClick={() => {
            setUseRecovery((v) => !v)
            resetMutation.reset()
          }}
        >
          {useRecovery ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
        <FormError>
          {resetMutation.isError
            ? errorMessage(resetMutation.error, 'Password reset failed')
            : null}
        </FormError>
        <Button type="submit" disabled={!ready || resetMutation.isPending}>
          {resetMutation.isPending ? 'Resetting…' : 'Set new password'}
        </Button>
        <button
          type="button"
          className="min-h-11 self-start text-sm text-[var(--muted-foreground)] underline-offset-4 hover:underline md:min-h-0"
          onClick={onBack}
        >
          Back to sign in
        </button>
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
  // ADR-080: the one-time enrolment code is asked for first, kept only in
  // memory, and sent again with the final step.
  const [enrolCode, setEnrolCode] = useState('')
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState<string[] | null>(null)
  const [saved, setSaved] = useState(false)
  const cancel = useCancelSignIn(onSession)

  const startMutation = useMutation({
    mutationFn: () => startPlatformEnrolment(enrolCode.trim()),
    onSuccess: setSetup,
  })

  const finishMutation = useMutation({
    mutationFn: () => finishPlatformEnrolment(code, enrolCode.trim()),
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
  const enrolCodeReady = enrolCode.replace(/[^A-Za-z0-9]/g, '').length >= 8
  const finishError = finishMutation.isError
    ? errorMessage(finishMutation.error, 'Verification failed')
    : null

  if (!setup) {
    return (
      <Shell
        title="Enter your enrolment code"
        subtitle="First sign-in: Platform Administration needs the one-time enrolment code before it shows your authenticator setup."
      >
        <form
          className="flex flex-col gap-4"
          onSubmit={(e) => {
            e.preventDefault()
            if (enrolCodeReady && !startMutation.isPending) startMutation.mutate()
          }}
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="platform-enrolment-code">Enrolment code</Label>
            <Input
              id="platform-enrolment-code"
              value={enrolCode}
              onChange={(e) => setEnrolCode(e.target.value)}
              autoComplete="off"
              autoCapitalize="characters"
              autoCorrect="off"
              spellCheck={false}
              autoFocus
              placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
              aria-describedby="platform-enrolment-code-help"
              className="min-h-11 font-mono md:min-h-0"
            />
            <p id="platform-enrolment-code-help" className="text-xs text-[var(--muted-foreground)]">
              The code your administrator gave you, separate from your password
            </p>
          </div>
          <FormError>{startError}</FormError>
          <Button
            type="submit"
            className="min-h-11 md:min-h-0"
            disabled={!enrolCodeReady || startMutation.isPending}
          >
            {startMutation.isPending ? 'Checking…' : 'Continue to sign in'}
          </Button>
          <button
            type="button"
            className="min-h-11 self-start text-sm text-[var(--muted-foreground)] underline-offset-4 hover:underline md:min-h-0"
            onClick={cancel}
          >
            Back to sign in
          </button>
        </form>
      </Shell>
    )
  }

  return (
    <Shell
      title="Set up two-step verification"
      subtitle="Platform Administration requires an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password, Authy…)."
    >
      <div className="flex flex-col gap-4">
        <FormError>{startError}</FormError>
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
                    showToast(ok ? 'success' : 'error', ok ? 'Setup key copied' : 'Could not copy')
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
