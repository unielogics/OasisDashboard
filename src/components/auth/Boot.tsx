// The boot splash (session loading) and the failure card (session or screen failed to load). Both are built from
// existing primitives: the header logo tile and wordmark, the Payments "No payment access" card.
import type { ReactNode } from 'react'
import { AuthFrame, LogoMark } from './Frame'
import { cardIconStyle, cardStyle, cardTextStyle, cardTitleStyle, primaryButtonStyle } from './styles'

export function BootSplash({ label = 'Loading' }: { label?: string }) {
  return (
    <AuthFrame header={false}>
      <div role="status" aria-label={label}>
        <LogoMark />
      </div>
    </AuthFrame>
  )
}

export function FailureCard({
  title,
  text,
  onRetry,
  children,
}: {
  title: string
  text: string
  onRetry?: () => void
  children?: ReactNode
}) {
  return (
    <AuthFrame>
      <div role="alert" style={cardStyle}>
        <div style={cardIconStyle}>
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <path d="M12 8v5M12 17h.01" stroke="var(--ink2)" strokeWidth="2" strokeLinecap="round" />
            <circle cx="12" cy="12" r="9" stroke="var(--ink2)" strokeWidth="2" />
          </svg>
        </div>
        <div style={cardTitleStyle}>{title}</div>
        <div style={cardTextStyle}>{text}</div>
        {onRetry && (
          <button type="button" onClick={onRetry} style={{ ...primaryButtonStyle(false), marginTop: '22px' }}>
            Try again
          </button>
        )}
        {children}
      </div>
    </AuthFrame>
  )
}
