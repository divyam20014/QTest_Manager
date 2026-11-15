import { useEffect, useState } from 'react'

import { EmbossedCard } from '@/components/ui/EmbossedCard'
import { TactileButton } from '@/components/ui/TactileButton'
import { GaugeDial } from '@/components/ui/GaugeDial'
import { CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Throwaway, unlinked preview of the Phase 1 tactile primitives, for
 * visual verification only. Not registered in nav. Remove this route
 * (and its App.tsx registration) once Phase 2 starts.
 */
export default function DesignPreview() {
  const [theme, setTheme] = useState<'light' | 'dark'>('light')

  // The theme tokens are scoped to :root[data-theme], not an arbitrary
  // ancestor div, so the attribute must go on the document root to take
  // effect -- restored on unmount so leaving this throwaway route
  // doesn't leak the override into the rest of the app.
  useEffect(() => {
    const prev = document.documentElement.getAttribute('data-theme')
    document.documentElement.setAttribute('data-theme', theme)
    return () => {
      if (prev) document.documentElement.setAttribute('data-theme', prev)
      else document.documentElement.removeAttribute('data-theme')
    }
  }, [theme])

  return (
    <div className="min-h-screen bg-[var(--background)] p-8 text-[var(--foreground)]">
      <button
        className="mb-6 rounded-md border border-[var(--border)] px-3 py-1.5 text-sm"
        onClick={() => setTheme((t) => (t === 'light' ? 'dark' : 'light'))}
      >
        Toggle theme (currently {theme})
      </button>

      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <EmbossedCard>
          <CardHeader>
            <CardTitle>EmbossedCard</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-[var(--muted-foreground)]">
              Raised tactile surface with subtle brushed texture.
            </p>
          </CardContent>
        </EmbossedCard>

        <EmbossedCard className="flex items-center justify-center p-6">
          <GaugeDial value={87} label="Pass rate" />
        </EmbossedCard>

        <EmbossedCard className="flex items-center justify-center p-6">
          <GaugeDial value={42} label="Coverage" />
        </EmbossedCard>

        <EmbossedCard>
          <CardHeader>
            <CardTitle>TactileButton</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <TactileButton>Default</TactileButton>
            <TactileButton size="sm">Small</TactileButton>
            <TactileButton size="lg">Large</TactileButton>
            <TactileButton disabled>Disabled</TactileButton>
          </CardContent>
        </EmbossedCard>
      </div>
    </div>
  )
}
