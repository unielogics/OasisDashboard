import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'
import { FailureCard } from './Boot'

/** Last line of defence under the providers: a render error shows the locked-card look instead of a blank page. */
export class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error): { error: Error } {
    return { error }
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error('[oasis] render error:', error, info.componentStack)
  }

  render(): ReactNode {
    if (!this.state.error) return this.props.children
    return (
      <FailureCard
        title="This screen failed to load"
        text="Reload the page. If it keeps happening, tell an administrator."
        onRetry={() => window.location.reload()}
      />
    )
  }
}
