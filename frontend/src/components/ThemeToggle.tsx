import { Moon, Sun } from 'lucide-react'
import { useThemePreference } from '@/lib/useThemePreference'

export function ThemeToggle({ showLabel = false }: { showLabel?: boolean } = {}) {
  const [theme, setTheme] = useThemePreference()

  function toggle() {
    setTheme(theme === 'dark' ? 'light' : 'dark')
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
      title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
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
}
