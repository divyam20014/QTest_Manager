import { useRef } from 'react'
import { Check } from 'lucide-react'

import { CustomThemeEditor } from '@/components/CustomThemeEditor'
import { DEFAULT_CUSTOM, ensureCustomTheme, loadCustomState } from '@/lib/customThemes'
import { PRESET_INPUTS } from '@/lib/themeDerive'
import { BASE_SWATCHES, isPreset, swatchFor, THEME_CHOICES, THEME_LABELS, type ThemeChoice } from '@/lib/themes'
import { useThemeChoice } from '@/lib/useThemePreference'
import { cn } from '@/lib/utils'

function swatchesOf(id: ThemeChoice): [string, string, string] {
  if (id === 'system' || id === 'light' || id === 'dark') return BASE_SWATCHES[id]
  if (isPreset(id)) return swatchFor(PRESET_INPUTS[id])
  const state = loadCustomState()
  const active = state.themes.find((t) => t.id === state.activeId)
  return active ? swatchFor(active) : swatchFor(DEFAULT_CUSTOM)
}

/** The theme picker: a radio group (arrow keys move and select) plus the custom editor. */
export function AppearancePanel() {
  const [choice, setChoice] = useThemeChoice()
  function pick(id: ThemeChoice) {
    if (id === 'custom') ensureCustomTheme()
    setChoice(id)
  }
  const refs = useRef<Array<HTMLButtonElement | null>>([])

  function onKeyDown(e: React.KeyboardEvent, index: number) {
    const step = e.key === 'ArrowDown' || e.key === 'ArrowRight' ? 1 : e.key === 'ArrowUp' || e.key === 'ArrowLeft' ? -1 : 0
    if (!step) return
    e.preventDefault()
    const next = (index + step + THEME_CHOICES.length) % THEME_CHOICES.length
    pick(THEME_CHOICES[next])
    refs.current[next]?.focus()
  }

  return (
    <div className="flex flex-col gap-5">
      <div>
        <p id="qth-theme-label" className="qth-type-label mb-2">
          Colour theme
        </p>
        <div role="radiogroup" aria-labelledby="qth-theme-label" className="grid gap-2 sm:grid-cols-2">
          {THEME_CHOICES.map((id, index) => {
            const selected = choice === id
            const [surface, primary, accent] = swatchesOf(id)
            return (
              <button
                key={id}
                ref={(el) => {
                  refs.current[index] = el
                }}
                type="button"
                role="radio"
                aria-checked={selected}
                tabIndex={selected || (choice === 'system' && index === 0) ? 0 : -1}
                onClick={() => pick(id)}
                onKeyDown={(e) => onKeyDown(e, index)}
                className={cn(
                  'flex min-h-11 items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm text-[var(--foreground)] transition-colors',
                  'hover:bg-[var(--muted)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
                  selected ? 'border-[var(--primary)] bg-[var(--brand-muted)]' : 'border-[var(--control-border,var(--border))]',
                )}
              >
                <span aria-hidden="true" className="flex shrink-0 -space-x-1">
                  {[surface, primary, accent].map((colour, i) => (
                    <span
                      key={i}
                      className="size-5 rounded-full border border-[var(--border-strong)]"
                      style={{ background: colour }}
                    />
                  ))}
                </span>
                <span className="flex-1">{THEME_LABELS[id]}</span>
                {selected && <Check aria-hidden="true" className="size-4" />}
              </button>
            )
          })}
        </div>
      </div>
      {choice === 'custom' && <CustomThemeEditor />}
      <p className="qth-type-helper">Saved in this browser only, so it follows you on this device, not your account.</p>
    </div>
  )
}
