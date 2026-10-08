import type { ReactNode } from 'react'
import { cardIconStyle, cardStyle, cardTextStyle, cardTitleStyle } from './styles'

/** The Payments locked card: icon tile, Bricolage title, grey sentence; the form (children) sits below it. */
export function Card({
  title,
  text,
  children,
  icon = 'lock',
}: {
  title: string
  text: string
  children?: ReactNode
  icon?: 'lock' | 'mail' | 'missing'
}) {
  return (
    <div style={cardStyle}>
      <div style={cardIconStyle}>
        {icon === 'missing' ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <circle cx="11" cy="11" r="6.5" stroke="var(--ink2)" strokeWidth="2" />
            <path d="M16 16l4 4" stroke="var(--ink2)" strokeWidth="2" strokeLinecap="round" />
          </svg>
        ) : icon === 'lock' ? (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="5" y="10" width="14" height="10" rx="2" stroke="var(--ink2)" strokeWidth="2" />
            <path d="M8 10V7a4 4 0 018 0v3" stroke="var(--ink2)" strokeWidth="2" />
          </svg>
        ) : (
          <svg width="28" height="28" viewBox="0 0 24 24" fill="none">
            <rect x="3.5" y="6" width="17" height="12" rx="2" stroke="var(--ink2)" strokeWidth="2" />
            <path d="M4 7.5l8 6 8-6" stroke="var(--ink2)" strokeWidth="2" strokeLinejoin="round" />
          </svg>
        )}
      </div>
      <h1 style={{ ...cardTitleStyle, margin: 0 }}>{title}</h1>
      <p style={{ ...cardTextStyle, marginBottom: '22px' }}>{text}</p>
      {children}
    </div>
  )
}

export const linkRowStyle = {
  display: 'flex',
  justifyContent: 'center',
  gap: '16px',
  marginTop: '16px',
  fontSize: '13px',
  fontWeight: 700,
} as const
