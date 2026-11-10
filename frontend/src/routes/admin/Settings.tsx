import { Settings as SettingsIcon } from 'lucide-react'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

// Placeholder: no tenant-settings backend endpoint exists yet (currency/
// timezone/MFA-delivery-mode configuration is currently set once at
// tenant bootstrap and is not editable via any API). This page is the
// sidebar's real landing target so the nav item isn't a dead link, but
// deliberately doesn't fabricate controls for behavior the backend
// doesn't support -- building that is separate, explicit scope.
export function Settings() {
  return (
    <div className="flex flex-col gap-4">
      <h1 className="text-lg font-semibold">Settings</h1>
      <Card>
        <CardHeader>
          <CardTitle>Organization Settings</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center gap-3 py-10 text-center">
            <SettingsIcon className="size-8 text-[var(--muted-foreground)]" />
            <p className="max-w-sm text-sm text-[var(--muted-foreground)]">
              Tenant-level configuration (currency, timezone, MFA delivery mode) isn't editable from the UI yet —
              it's set once when your organization is provisioned. Reach out to your platform administrator if
              something needs to change.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
