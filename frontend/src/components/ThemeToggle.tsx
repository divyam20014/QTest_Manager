import { Moon, Sun } from 'lucide-react'
import { Tooltip } from '@/components/ui/tooltip'
import { useThemePreference } from '@/lib/useThemePreference'

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean } = {}) {
  const [theme, setTheme] = useThemePreference()

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  const label = theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'
  const button = (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      className={
        showLabel
          ? 'flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-sm text-[var(--foreground)] hover:bg-[var(--muted)]'
          : 'rounded-md p-1.5 text-[var(--muted-foreground)] hover:bg-[var(--muted)]'
      }
    >
      {theme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
      {showLabel && (theme === 'dark' ? 'Light mode' : 'Dark mode')}
    </button>
  )
  // The labelled (More-sheet) variant already shows its text; the icon-only
  // header variant gets a keyboard- and touch-reachable tooltip instead of title=.
  return showLabel ? button : <Tooltip content={label} side="bottom">{button}</Tooltip>
}
