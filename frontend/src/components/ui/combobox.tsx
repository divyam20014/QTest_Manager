import { Check, ChevronDown, Search, X } from 'lucide-react'
import { type KeyboardEvent, type Ref, useEffect, useId, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'

export interface ComboboxOption {
  value: string
  label: string
  disabled?: boolean
}

export interface ComboboxProps {
  value: string
  onChange: (value: string) => void
  options: ComboboxOption[]
  placeholder?: string
  /** Becomes the id of the hidden native <select> (see below); pair it with <Label htmlFor>. */
  id?: string
  name?: string
  className?: string
  required?: boolean
  disabled?: boolean
  /** Visual error state; FormField's `aria-invalid` is honoured too. */
  error?: boolean
  clearable?: boolean
  /** Force the search box on/off. Default: on when there are more than 8 options. */
  searchable?: boolean
  onBlur?: () => void
  /** Ref to the hidden native <select> (form libraries read/write its value). */
  selectRef?: Ref<HTMLSelectElement>
  'aria-label'?: string
  'aria-invalid'?: boolean | 'true' | 'false'
  'aria-describedby'?: string
}

const SEARCH_THRESHOLD = 8

/**
 * Custom single select (listbox semantics, no native popup).
 *
 * Playwright / form-field compatibility: the component renders a visually
 * hidden native <select> that carries `id` and `name` and mirrors `value`, so
 * `page.selectOption('#id', 'x')`, `<Label htmlFor=id>` and native form
 * submission keep working unchanged. Focusing that hidden select (label click,
 * Playwright) forwards focus to the visible trigger, whose id is `${id}-trigger`.
 * The hidden select carries an empty-value placeholder option only while the value is empty (so react-hook-form does not see it as "edited"), like a
 * native select with a blank first option.
 */
export function Combobox({
  value,
  onChange,
  options,
  placeholder = 'Select...',
  id,
  name,
  className,
  required,
  disabled,
  error,
  clearable,
  searchable,
  onBlur,
  selectRef,
  'aria-label': ariaLabel,
  'aria-invalid': ariaInvalid,
  'aria-describedby': ariaDescribedBy,
}: ComboboxProps) {
  const uid = useId()
  const baseId = id ?? uid
  const listId = `${baseId}-list`
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(-1)
  const [labelText, setLabelText] = useState<string | undefined>()
  const triggerRef = useRef<HTMLButtonElement>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLUListElement>(null)
  const typeahead = useRef({ buffer: '', timer: 0 })

  const showSearch = searchable ?? options.length > SEARCH_THRESHOLD
  const selected = options.find((o) => o.value === value)
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
  }, [options, query])
  const invalid = error || ariaInvalid === true || ariaInvalid === 'true'

  // Name the trigger from an external <label for=id> when no aria-label is given.
  useEffect(() => {
    if (ariaLabel || !id) return
    const label = Array.from(document.querySelectorAll('label')).find((l) => l.htmlFor === id)
    setLabelText(label?.textContent?.replace(/\*/g, '').trim() || undefined)
  }, [ariaLabel, id])

  useEffect(() => {
    if (!open) return
    function onDown(e: MouseEvent) {
      if (!triggerRef.current?.closest('[data-combobox-root]')?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  useEffect(() => {
    if (open && showSearch) searchRef.current?.focus()
  }, [open, showSearch])

  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.children[active]?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  const enabledFrom = (list: ComboboxOption[], start: number, dir: 1 | -1) => {
    for (let i = start; i >= 0 && i < list.length; i += dir) if (!list[i].disabled) return i
    return -1
  }

  function openMenu(at?: 'first' | 'last') {
    if (disabled) return
    setQuery('')
    setOpen(true)
    if (at === 'last') setActive(enabledFrom(options, options.length - 1, -1))
    else if (at === 'first') setActive(enabledFrom(options, 0, 1))
    else {
      const i = options.findIndex((o) => o.value === value)
      setActive(i >= 0 ? i : enabledFrom(options, 0, 1))
    }
  }

  function close(refocus = true) {
    setOpen(false)
    setQuery('')
    if (refocus) triggerRef.current?.focus()
  }

  function choose(opt: ComboboxOption) {
    if (opt.disabled) return
    onChange(opt.value)
    close()
  }

  function move(list: ComboboxOption[], from: number, dir: 1 | -1) {
    const next = enabledFrom(list, from + dir, dir)
    if (next >= 0) setActive(next)
  }

  function onKeyDown(e: KeyboardEvent<HTMLElement>) {
    const inSearch = e.target === searchRef.current
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) openMenu()
        else move(visible, active, 1)
        return
      case 'ArrowUp':
        e.preventDefault()
        if (!open) openMenu()
        else move(visible, active < 0 ? visible.length : active, -1)
        return
      case 'Home':
        if (inSearch) return
        e.preventDefault()
        if (!open) openMenu('first')
        else setActive(enabledFrom(visible, 0, 1))
        return
      case 'End':
        if (inSearch) return
        e.preventDefault()
        if (!open) openMenu('last')
        else setActive(enabledFrom(visible, visible.length - 1, -1))
        return
      case 'Enter':
        e.preventDefault()
        if (!open) openMenu()
        else if (visible[active]) choose(visible[active])
        return
      case ' ':
        if (inSearch) return
        e.preventDefault()
        if (!open) openMenu()
        else if (visible[active]) choose(visible[active])
        return
      case 'Escape':
        if (open) {
          e.preventDefault()
          e.stopPropagation()
          close()
        }
        return
      case 'Tab':
        if (open) close(false)
        return
    }
    // Type-ahead (trigger only; the search box filters instead).
    if (!inSearch && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const ta = typeahead.current
      window.clearTimeout(ta.timer)
      ta.buffer += e.key.toLowerCase()
      ta.timer = window.setTimeout(() => {
        ta.buffer = ''
      }, 500)
      const list = open ? visible : options
      if (list.length === 0) return
      // A repeated single letter cycles to the next match; a longer prefix may stay put.
      const start = Math.max(active, 0) + (ta.buffer.length > 1 ? 0 : 1)
      for (let n = 0; n < list.length; n++) {
        const i = (start + n) % list.length
        if (!list[i].disabled && list[i].label.toLowerCase().startsWith(ta.buffer)) {
          if (!open) openMenu()
          setActive(i)
          break
        }
      }
    }
  }

  const activeId = open && visible[active] ? `${baseId}-opt-${active}` : undefined
  const triggerName = ariaLabel ?? labelText
  const hasClear = clearable && selected && value !== '' && !disabled

  return (
    <div data-combobox-root className={cn('relative w-full', className)}>
      {/* Hidden native mirror: carries id/name/value for forms and Playwright. */}
      <select
        ref={selectRef}
        id={id}
        name={name}
        value={value}
        required={required}
        disabled={disabled}
        aria-hidden="true"
        aria-label={ariaLabel}
        tabIndex={-1}
        onFocus={() => triggerRef.current?.focus()}
        onChange={(e) => onChange(e.target.value)}
        className="sr-only"
      >
        {value === '' && !options.some((o) => o.value === '') && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value} disabled={o.disabled}>
            {o.label}
          </option>
        ))}
      </select>
      <div className="relative flex">
        <button
          ref={triggerRef}
          id={`${baseId}-trigger`}
          type="button"
          role="combobox"
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open && !showSearch ? activeId : undefined}
          aria-label={triggerName}
          aria-invalid={invalid || undefined}
          aria-required={required || undefined}
          aria-describedby={ariaDescribedBy}
          disabled={disabled}
          onClick={() => (open ? close() : openMenu())}
          onKeyDown={onKeyDown}
          onBlur={onBlur}
          className={cn(
            'flex h-9 w-full items-center justify-between gap-2 rounded-[var(--radius-control)] border border-[var(--control-border,var(--border))] bg-[var(--background)] px-3 text-left text-sm transition-colors duration-[var(--motion-base)] motion-reduce:transition-none',
            'hover:border-[var(--muted-foreground)] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-[var(--ring)]',
            'disabled:cursor-not-allowed disabled:opacity-50 max-md:h-11 max-md:text-base',
            invalid && 'border-[var(--destructive)]',
            hasClear && 'pr-14',
          )}
        >
          <span className={cn('truncate', !selected && 'text-[var(--muted-foreground)]')}>
            {selected && value !== '' ? selected.label : placeholder}
          </span>
          <ChevronDown
            aria-hidden="true"
            className={cn(
              'size-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-[var(--motion-base)] motion-reduce:transition-none',
              open && 'rotate-180',
            )}
          />
        </button>
        {hasClear && (
          <button
            type="button"
            aria-label="Clear selection"
            onClick={() => {
              onChange('')
              triggerRef.current?.focus()
            }}
            className="absolute right-8 top-1/2 flex size-8 -translate-y-1/2 items-center justify-center rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] focus-visible:outline-2 focus-visible:outline-[var(--ring)]"
          >
            <X aria-hidden="true" className="size-4" />
          </button>
        )}
      </div>
      {open && (
        <div
          data-overlay-popup
          className="absolute left-0 top-full z-[var(--z-dropdown)] mt-1 w-full min-w-40 rounded-[var(--radius-control)] border border-[var(--border)] bg-[var(--tactile-surface-raised)] p-1 text-sm shadow-lg"
        >
          {showSearch && (
            <div className="relative mb-1">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-2 top-1/2 size-4 -translate-y-1/2 text-[var(--muted-foreground)]"
              />
              <input
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded="true"
                aria-controls={listId}
                aria-activedescendant={activeId}
                aria-autocomplete="list"
                aria-label="Search options"
                autoComplete="off"
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value)
                  const q = e.target.value.trim().toLowerCase()
                  const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options
                  setActive(enabledFrom(list, 0, 1))
                }}
                onKeyDown={onKeyDown}
                className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] pl-8 pr-2 text-sm focus-visible:outline-2 focus-visible:outline-[var(--ring)] max-md:h-11 max-md:text-base"
              />
            </div>
          )}
          <ul ref={listRef} id={listId} role="listbox" aria-label={triggerName ?? 'Options'} className="max-h-60 overflow-y-auto">
            {visible.length === 0 && (
              <li role="option" aria-disabled="true" aria-selected="false" className="px-3 py-2 text-[var(--muted-foreground)]">
                No matches
              </li>
            )}
            {visible.map((o, i) => (
              <li
                key={o.value}
                id={`${baseId}-opt-${i}`}
                role="option"
                aria-selected={o.value === value}
                aria-disabled={o.disabled || undefined}
                // mousedown keeps focus on the trigger / search box.
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => !o.disabled && setActive(i)}
                className={cn(
                  'flex min-h-8 cursor-pointer items-center justify-between gap-2 rounded-md px-3 py-1.5 max-md:min-h-11',
                  i === active && 'bg-[var(--muted)]',
                  o.disabled && 'cursor-not-allowed opacity-50',
                )}
              >
                <span className="truncate">{o.label}</span>
                {o.value === value && <Check aria-hidden="true" className="size-4 shrink-0 text-[var(--primary)]" />}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
