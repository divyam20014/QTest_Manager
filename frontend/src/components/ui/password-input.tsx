import { type InputHTMLAttributes, forwardRef, useState } from 'react'
import { Eye, EyeOff } from 'lucide-react'

import { Input } from '@/components/ui/input'
import { passwordStrength } from '@/lib/passwordStrength'

/**
 * Password field with a show/hide toggle. The input keeps its own name,
 * autocomplete and id, so password managers keep working; toggling only flips type.
 */
export const PasswordInput = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  ({ className, ...props }, ref) => {
    const [shown, setShown] = useState(false)
    return (
      <div className="relative">
        <Input ref={ref} type={shown ? 'text' : 'password'} className={`pr-12 ${className ?? ''}`} {...props} />
        <button
          type="button"
          aria-pressed={shown}
          aria-label="Show characters"
          onClick={() => setShown((v) => !v)}
          className="absolute inset-y-0 right-0 flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--ring)] md:w-10 md:min-w-10 md:min-h-0"
        >
          {shown ? <EyeOff aria-hidden="true" className="size-4" /> : <Eye aria-hidden="true" className="size-4" />}
        </button>
      </div>
    )
  },
)
PasswordInput.displayName = 'PasswordInput'

/** Text + bar strength meter (never colour alone); announced politely as it changes. */
export function PasswordStrengthMeter({ value }: { value: string }) {
  if (!value) return null
  const { score, label } = passwordStrength(value)
  return (
    <div role="status" data-testid="password-strength" className="flex items-center gap-2 text-xs">
      <div aria-hidden="true" className="flex h-1.5 w-24 gap-0.5">
        {[1, 2, 3, 4].map((i) => (
          <span
            key={i}
            className={`h-full flex-1 rounded-full ${i <= score ? 'bg-[var(--primary)]' : 'bg-[var(--muted)]'}`}
          />
        ))}
      </div>
      <span className="text-[var(--muted-foreground)]">Strength: {label}</span>
    </div>
  )
}
