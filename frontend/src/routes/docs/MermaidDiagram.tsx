import { useEffect, useId, useState } from 'react'

import { useThemePreference } from '@/lib/useThemePreference'

// Mermaid is large, so it is only fetched (as its own chunk, via a dynamic
// import) the first time a document that contains a diagram is opened.
type MermaidApi = (typeof import('mermaid'))['default']
let mermaidPromise: Promise<MermaidApi> | null = null
function loadMermaid(): Promise<MermaidApi> {
  mermaidPromise ??= import('mermaid').then((m) => m.default)
  return mermaidPromise
}

const svgCache = new Map<string, string>()
let renderCounter = 0

type State =
  | { status: 'loading' }
  | { status: 'ready'; svg: string }
  | { status: 'error'; message: string }

/**
 * Renders one fenced mermaid block as a picture. securityLevel "strict" makes
 * Mermaid sanitise its own output (no HTML labels, no click handlers), so
 * injecting the SVG is safe. If rendering fails the source is shown instead --
 * a broken diagram never blanks the document.
 */
export function MermaidDiagram({ source }: { source: string }) {
  const [theme] = useThemePreference()
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '')
  const key = `${theme}|${source}`
  // Async results are stored with the key they were drawn for, so a stale
  // result (older theme or text) is never shown; a cached drawing needs no state.
  const [result, setResult] = useState<{ key: string; state: State } | null>(null)
  const cached = svgCache.get(key)
  const state: State = cached
    ? { status: 'ready', svg: cached }
    : result && result.key === key
      ? result.state
      : { status: 'loading' }

  useEffect(() => {
    if (svgCache.has(key)) return
    let cancelled = false
    const finish = (next: State) => {
      if (!cancelled) setResult({ key, state: next })
    }
    loadMermaid()
      .then(async (mermaid) => {
        mermaid.initialize({
          startOnLoad: false,
          securityLevel: 'strict',
          theme: theme === 'dark' ? 'dark' : 'default',
          fontFamily: 'inherit',
          // Mermaid's own dark palette draws edge labels at 4.43:1, just under
          // the 4.5:1 WCAG AA minimum; a slightly darker label background fixes it.
          themeVariables: theme === 'dark' ? { edgeLabelBackground: '#3f3f46' } : {},
        })
        const id = `mmd-${uid}-${renderCounter++}`
        try {
          const { svg } = await mermaid.render(id, source)
          svgCache.set(key, svg)
          finish({ status: 'ready', svg })
        } catch (error) {
          // Mermaid leaves a stray error element in <body> when a render fails.
          document.getElementById(`d${id}`)?.remove()
          document.getElementById(id)?.remove()
          finish({
            status: 'error',
            message: error instanceof Error ? (error.message.split(/\r?\n/)[0] ?? '') : 'The diagram could not be drawn.',
          })
        }
      })
      .catch(() => finish({ status: 'error', message: 'The diagram renderer could not be loaded.' }))
    return () => {
      cancelled = true
    }
  }, [key, source, theme, uid])

  return (
    <figure className="brd-diagram" data-state={state.status}>
      {state.status === 'loading' && (
        <p role="status" className="brd-diagram-note">
          Drawing diagram…
        </p>
      )}
      {state.status === 'ready' && (
        <div
          className="brd-diagram-canvas"
          tabIndex={0}
          role="img"
          aria-label="Diagram. The same content is available as text under Diagram source."
          // Mermaid's output under securityLevel "strict" (sanitised by Mermaid).
          dangerouslySetInnerHTML={{ __html: state.svg }}
        />
      )}
      {state.status === 'error' && (
        <p role="alert" className="brd-diagram-note brd-diagram-error">
          This diagram could not be drawn ({state.message}). Its source is shown below.
        </p>
      )}
      <details className="brd-diagram-source" open={state.status === 'error' ? true : undefined}>
        <summary>Diagram source</summary>
        <pre tabIndex={0}>{source}</pre>
      </details>
    </figure>
  )
}
