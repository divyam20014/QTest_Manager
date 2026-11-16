import { Component, type ErrorInfo, type ReactNode, Suspense } from 'react'

import { ErrorState } from '@/components/ui/empty-state'
import { DetailSkeleton } from '@/components/ui/skeleton'

/** Catches render/chunk-load failures of a lazy route so a failed download
 * (e.g. a deploy replaced the hashed chunk) shows a retry state instead of a
 * blank page. Resets when `resetKey` (the pathname) changes. */
interface BoundaryProps {
  children: ReactNode
  resetKey: string
}

interface BoundaryState {
  failed: boolean
  resetKey: string
}

class RouteErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false, resetKey: this.props.resetKey }

  static getDerivedStateFromError(): Partial<BoundaryState> {
    return { failed: true }
  }

  static getDerivedStateFromProps(props: BoundaryProps, state: BoundaryState): Partial<BoundaryState> | null {
    if (props.resetKey !== state.resetKey) return { failed: false, resetKey: props.resetKey }
    return null
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Route failed to render', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <ErrorState
          message="This page could not be loaded. Check your connection and try again."
          onRetry={() => window.location.reload()}
        />
      )
    }
    return this.props.children
  }
}

/** Suspense + error boundary for lazy route elements. The design-system
 * skeleton is the fallback so there is no flash of an unstyled/blank page. */
export function RouteBoundary({ children, resetKey }: { children: ReactNode; resetKey: string }) {
  return (
    <RouteErrorBoundary resetKey={resetKey}>
      <Suspense fallback={<DetailSkeleton />}>{children}</Suspense>
    </RouteErrorBoundary>
  )
}
