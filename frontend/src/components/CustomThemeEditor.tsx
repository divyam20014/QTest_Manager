import { useMemo, useState, type CSSProperties } from 'react'
import { AlertTriangle, CheckCircle2, Info, Plus, RotateCcw, Trash2, XCircle } from 'lucide-react'

import { Button } from '@/components/ui/button'
import {
  cleanName,
  DEFAULT_CUSTOM,
  loadCustomState,
  MAX_CUSTOM_THEMES,
  MAX_NAME,
  newThemeId,
  saveCustomState,
  type CustomState,
  type CustomTheme,
} from '@/lib/customThemes'
import { deriveTheme, normalizeHex, type Tint } from '@/lib/themeDerive'
import { PALETTE_SWATCHES } from '@/lib/themes'
import { refreshTheme, setThemeChoice } from '@/lib/useThemePreference'
import { cn } from '@/lib/utils'

const TINT_LABELS: Array<[Tint, string]> = [
  ['neutral', 'Neutral'],
  ['warm', 'Warm'],
  ['cool', 'Cool'],
  ['lavender', 'Lavender'],
]

const fieldClass =
  'qth-pressed-sm h-11 rounded-md border border-[var(--control-border,var(--border))] bg-transparent px-3 text-sm text-[var(--foreground)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]'

function ColourField({ label, value, onChange }: { label: string; value: string; onChange: (hex: string) => void }) {
  const [text, setText] = useState(value)
  const [lastValue, setLastValue] = useState(value)
  if (value !== lastValue) {
    setLastValue(value)
    setText(value)
  }
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="qth-type-label mb-1">{label} colour</legend>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={`${label} colour picker`}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-11 w-14 cursor-pointer rounded-md border border-[var(--control-border,var(--border))] bg-transparent p-1"
        />
        <input
          type="text"
          aria-label={`${label} colour hex`}
          value={text}
          maxLength={7}
          spellCheck={false}
          onChange={(e) => {
            setText(e.target.value)
            const hex = normalizeHex(e.target.value)
            if (hex) onChange(hex)
          }}
          aria-invalid={normalizeHex(text) === null}
          className={cn(fieldClass, 'w-28 font-mono')}
        />
      </div>
      <div role="group" aria-label={`${label} colour palette`} className="flex flex-wrap gap-1.5">
        {PALETTE_SWATCHES.map((hex) => (
          <button
            key={hex}
            type="button"
            aria-label={`${label} ${hex}`}
            aria-pressed={value === hex}
            onClick={() => onChange(hex)}
            style={{ background: hex }}
            className={cn(
              'size-9 rounded-full border-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--ring)]',
              value === hex ? 'border-[var(--foreground)]' : 'border-[var(--border-strong)]',
            )}
          />
        ))}
      </div>
    </fieldset>
  )
}

function NameField({ name, onCommit }: { name: string; onCommit: (name: string) => void }) {
  const [text, setText] = useState(name)
  return (
    <label className="flex flex-col gap-1">
      <span className="qth-type-label">Theme name</span>
      <input
        type="text"
        value={text}
        maxLength={MAX_NAME}
        onChange={(e) => {
          setText(e.target.value)
          const clean = cleanName(e.target.value)
          if (clean) onCommit(clean)
        }}
        onBlur={() => {
          if (!cleanName(text)) {
            setText('My theme')
            onCommit('My theme')
          }
        }}
        className={cn(fieldClass, 'w-full max-w-xs')}
      />
      <span className="qth-type-helper">Up to {MAX_NAME} characters. You can save {MAX_CUSTOM_THEMES} themes.</span>
    </label>
  )
}

function Preview({ theme }: { theme: CustomTheme }) {
  const d = useMemo(() => deriveTheme(theme), [theme])
  return (
    <div
      aria-label="Theme preview"
      role="group"
      style={{ ...(d.tokens as CSSProperties), colorScheme: d.scheme }}
      className="flex flex-col gap-3 rounded-xl border border-[var(--border)] bg-[var(--background)] p-4 text-[var(--foreground)]"
    >
      <p className="text-sm font-semibold">Preview</p>
      <p className="text-sm text-[var(--muted-foreground)]">
        Body text with a <a href="#preview" onClick={(e) => e.preventDefault()} className="text-[var(--link)] underline">link</a>.
      </p>
      <div className="flex flex-wrap gap-2">
        <span className="inline-flex min-h-9 items-center rounded-md bg-[var(--primary)] px-3 text-sm font-medium text-[var(--primary-foreground)]">
          Primary
        </span>
        <span className="inline-flex min-h-9 items-center rounded-md bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-foreground)]">
          Accent
        </span>
        <span className="inline-flex min-h-9 items-center rounded-full bg-[var(--brand-muted)] px-3 text-xs font-medium text-[var(--link)]">
          Badge
        </span>
      </div>
      <div
        aria-hidden="true"
        className="flex h-11 items-center rounded-md border border-[var(--control-border)] bg-[var(--tactile-surface-raised)] px-3 text-sm text-[var(--muted-foreground)]"
      >
        Input field
      </div>
      <div className="flex flex-wrap gap-2 text-xs font-medium">
        {[
          ['good', 'Passed', CheckCircle2],
          ['warning', 'Warning', AlertTriangle],
          ['serious', 'Failed', XCircle],
          ['info', 'Info', Info],
        ].map(([key, label, Icon]) => {
          const I = Icon as typeof Info
          return (
            <span
              key={key as string}
              className="inline-flex items-center gap-1 rounded-full px-2 py-1"
              style={{ color: `var(--status-${key})`, background: `var(--status-${key}-bg)` }}
            >
              <I aria-hidden="true" className="size-3.5" />
              {label as string}
            </span>
          )
        })}
      </div>
    </div>
  )
}

/** "Create your theme": base mode, primary, accent and surface tint in; a contrast-checked token set out. */
export function CustomThemeEditor() {
  const [state, setState] = useState<CustomState>(() => loadCustomState())
  const active = state.themes.find((t) => t.id === state.activeId) ?? state.themes[0]
  const derived = useMemo(() => (active ? deriveTheme(active) : null), [active])

  if (!active || !derived) return null

  function commit(next: CustomState) {
    setState(next)
    saveCustomState(next)
    if (next.themes.length === 0) setThemeChoice('system')
    else refreshTheme()
  }
  function patch(change: Partial<CustomTheme>) {
    commit({ ...state, themes: state.themes.map((t) => (t.id === active!.id ? { ...t, ...change } : t)) })
  }
  const lowest = derived.checks.reduce((m, c) => (c.ratio < m.ratio ? c : m))

  return (
    <section aria-labelledby="qth-custom-title" className="flex flex-col gap-4 rounded-xl border border-[var(--border)] p-4">
      <h3 id="qth-custom-title" className="text-sm font-semibold">
        Create your theme
      </h3>

      <div role="radiogroup" aria-label="Saved custom themes" className="flex flex-wrap items-center gap-2">
        {state.themes.map((t) => (
          <button
            key={t.id}
            type="button"
            role="radio"
            aria-checked={t.id === active.id}
            onClick={() => commit({ ...state, activeId: t.id })}
            className={cn(
              'min-h-11 rounded-md border px-3 text-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--ring)]',
              t.id === active.id
                ? 'border-[var(--primary)] bg-[var(--brand-muted)] font-medium'
                : 'border-[var(--control-border,var(--border))] hover:bg-[var(--muted)]',
            )}
          >
            {t.name}
          </button>
        ))}
        {state.themes.length < MAX_CUSTOM_THEMES && (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              const t: CustomTheme = { id: newThemeId(), name: `Theme ${state.themes.length + 1}`, ...DEFAULT_CUSTOM }
              commit({ themes: [...state.themes, t], activeId: t.id })
            }}
          >
            <Plus aria-hidden="true" className="size-4" /> New theme
          </Button>
        )}
      </div>

      <NameField key={active.id} name={active.name} onCommit={(name) => patch({ name })} />

      <fieldset className="flex flex-col gap-2">
        <legend className="qth-type-label mb-1">Base mode</legend>
        <div className="flex gap-2">
          {(['light', 'dark'] as const).map((mode) => (
            <label
              key={mode}
              className={cn(
                'flex min-h-11 flex-1 cursor-pointer items-center justify-center rounded-md border px-3 text-sm capitalize has-[:focus-visible]:outline has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-[var(--ring)]',
                active.base === mode ? 'border-[var(--primary)] bg-[var(--brand-muted)] font-medium' : 'border-[var(--control-border,var(--border))]',
              )}
            >
              <input
                type="radio"
                name="qth-custom-base"
                className="sr-only"
                checked={active.base === mode}
                onChange={() => patch({ base: mode })}
              />
              {mode}
            </label>
          ))}
        </div>
      </fieldset>

      <ColourField label="Primary" value={active.primary} onChange={(primary) => patch({ primary })} />
      <ColourField label="Accent" value={active.accent} onChange={(accent) => patch({ accent })} />

      <label className="flex flex-col gap-1">
        <span className="qth-type-label">Surface tint</span>
        <select
          value={active.tint === 'charcoal' ? 'neutral' : active.tint}
          onChange={(e) => patch({ tint: e.target.value as Tint })}
          className={cn(fieldClass, 'w-full max-w-xs')}
        >
          {TINT_LABELS.map(([id, label]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </select>
      </label>

      <div role="status" data-testid="contrast-badge" className="flex flex-col gap-2">
        <p
          className={cn(
            'inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium',
            derived.allPass
              ? 'bg-[var(--status-good-bg)] text-[var(--status-good)]'
              : 'bg-[var(--status-serious-bg)] text-[var(--status-serious)]',
          )}
        >
          {derived.allPass ? <CheckCircle2 aria-hidden="true" className="size-4" /> : <XCircle aria-hidden="true" className="size-4" />}
          {derived.allPass ? 'AA pass' : 'Below AA'}
          <span className="font-normal">
            lowest {lowest.ratio.toFixed(2)}:1 ({lowest.label})
          </span>
        </p>
        {derived.adjusted.map((message) => (
          <p key={message} className="flex items-start gap-1.5 text-sm text-[var(--status-warning)]">
            <AlertTriangle aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
            {message}
          </p>
        ))}
        <details className="text-sm">
          <summary className="min-h-11 cursor-pointer py-2">Contrast details</summary>
          <ul className="flex flex-col gap-1 pb-2">
            {derived.checks.map((c) => (
              <li key={c.label}>
                {c.label}: {c.ratio.toFixed(2)}:1 (needs {c.min}:1) {c.pass ? 'pass' : 'fail'}
              </li>
            ))}
          </ul>
        </details>
      </div>

      <Preview theme={active} />

      <div className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" onClick={() => patch({ ...DEFAULT_CUSTOM })}>
          <RotateCcw aria-hidden="true" className="size-4" /> Reset colours
        </Button>
        <Button
          type="button"
          variant="destructive"
          onClick={() => {
            const themes = state.themes.filter((t) => t.id !== active.id)
            commit({ themes, activeId: themes[0]?.id ?? null })
          }}
        >
          <Trash2 aria-hidden="true" className="size-4" /> Delete theme
        </Button>
      </div>
    </section>
  )
}
