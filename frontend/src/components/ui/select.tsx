import {
  Children,
  type ChangeEvent,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  forwardRef,
  isValidElement,
  useCallback,
  useMemo,
  useState,
} from 'react'

import { Combobox, type ComboboxOption } from '@/components/ui/combobox'

type OptionEl = ReactElement<{ value?: string | number; disabled?: boolean; children?: ReactNode }>

function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children)
  return ''
}

/** Flatten <option> children (including fragments, arrays and maps) into Combobox options. */
function collect(children: ReactNode, out: ComboboxOption[]) {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === 'option') {
      const el = child as OptionEl
      const label = textOf(el.props.children)
      out.push({
        value: el.props.value != null ? String(el.props.value) : label,
        label,
        disabled: el.props.disabled,
      })
    } else {
      collect((child.props as { children?: ReactNode }).children, out)
    }
  })
}

export type SelectProps = Omit<SelectHTMLAttributes<HTMLSelectElement>, 'onChange'> & {
  onChange?: (e: ChangeEvent<HTMLSelectElement>) => void
}

/**
 * Drop-in replacement for a native select element, rendered as the custom Combobox.
 * Takes the same <option> children, `value`/`defaultValue`, and an onChange that
 * receives an event-like object (`e.target.value`, `e.target.name`), so existing
 * call sites and react-hook-form's `register()` keep working. The forwarded ref
 * is the Combobox's hidden native select element (same id/name), which RHF reads and
 * writes; programmatic `ref.value = x` writes are mirrored into the visible state.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  {
    children,
    value,
    defaultValue,
    onChange,
    onBlur,
    id,
    name,
    className,
    required,
    disabled,
    'aria-label': ariaLabel,
    'aria-invalid': ariaInvalid,
    'aria-describedby': ariaDescribedBy,
  },
  ref,
) {
  const all = useMemo(() => {
    const out: ComboboxOption[] = []
    collect(children, out)
    return out
  }, [children])

  const controlled = value !== undefined
  const [inner, setInner] = useState<string>(() => {
    if (defaultValue !== undefined) return String(Array.isArray(defaultValue) ? defaultValue[0] : defaultValue)
    // A native select with no blank option shows its first option.
    return all.some((o) => o.value === '') ? '' : (all[0]?.value ?? '')
  })
  const current = controlled ? String(value) : inner

  const setRef = useCallback(
    (el: HTMLSelectElement | null) => {
      if (el && !(el as HTMLSelectElement & { __mirrored?: boolean }).__mirrored) {
        // Mirror programmatic value writes (react-hook-form reset/setValue) into state.
        const proto = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value')
        if (proto?.get && proto.set) {
          Object.defineProperty(el, 'value', {
            configurable: true,
            get() {
              return proto.get!.call(el)
            },
            set(v: string) {
              proto.set!.call(el, v)
              setInner(String(v ?? ''))
            },
          })
          ;(el as HTMLSelectElement & { __mirrored?: boolean }).__mirrored = true
        }
      }
      if (typeof ref === 'function') ref(el)
      else if (ref) ref.current = el
    },
    [ref],
  )

  function handle(next: string) {
    if (!controlled) setInner(next)
    const target = { value: next, name: name ?? '', id: id ?? '' }
    onChange?.({ target, currentTarget: target, type: 'change' } as unknown as ChangeEvent<HTMLSelectElement>)
  }

  // A blank <option value=""> acts as the placeholder; keep it selectable.
  const blank = all.find((o) => o.value === '')

  return (
    <Combobox
      id={id}
      name={name}
      className={className}
      value={current}
      onChange={handle}
      options={all}
      placeholder={blank?.label || 'Select...'}
      required={required}
      disabled={disabled}
      onBlur={onBlur ? () => onBlur({ target: { name: name ?? '', value: current }, type: 'blur' } as never) : undefined}
      selectRef={setRef}
      aria-label={ariaLabel}
      aria-invalid={ariaInvalid === 'grammar' || ariaInvalid === 'spelling' ? true : ariaInvalid}
      aria-describedby={ariaDescribedBy}
    />
  )
})
Select.displayName = 'Select'
