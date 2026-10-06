// Style objects for the login-family pages and the boot splash. Every value is copied from a primitive the designs
// already use (source in the comment); there are no new colours, shadows, radii, animations or hover states.
import type { CSSProperties } from 'react'

/** Root wrapper of every screen (Payments/Settings template root). */
export const rootStyle: CSSProperties = {
  height: '100vh',
  overflow: 'hidden',
  display: 'flex',
  flexDirection: 'column',
  background: 'var(--bg)',
  color: 'var(--ink)',
  fontFamily: "'Manrope',system-ui,sans-serif",
  WebkitFontSmoothing: 'antialiased',
  fontFeatureSettings: "'tnum'",
  letterSpacing: '-0.01em',
}

/** Header bar (logo tile and wordmark), as in the screens' header. */
export const headerStyle: CSSProperties = {
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  gap: '18px',
  padding: '14px 26px',
  borderBottom: '1px solid var(--line)',
}
export const logoTileStyle: CSSProperties = {
  width: '42px',
  height: '42px',
  borderRadius: '13px',
  background: 'var(--accent)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}
export const wordmarkStyle: CSSProperties = {
  fontFamily: "'Bricolage Grotesque',sans-serif",
  fontWeight: 700,
  fontSize: '18px',
  letterSpacing: '-0.02em',
}
export const wordmarkSubStyle: CSSProperties = {
  fontSize: '11px',
  color: 'var(--ink3)',
  fontWeight: 600,
  letterSpacing: '0.04em',
  textTransform: 'uppercase',
}

/** Payments "No payment access" card. */
export const cardStyle: CSSProperties = {
  width: '100%',
  maxWidth: '440px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '22px',
  padding: '36px',
  boxShadow: 'var(--shadow)',
}
export const cardIconStyle: CSSProperties = {
  width: '60px',
  height: '60px',
  borderRadius: '18px',
  background: 'var(--panel3)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  margin: '0 auto 16px',
}
export const cardTitleStyle: CSSProperties = {
  fontFamily: "'Bricolage Grotesque',sans-serif",
  fontWeight: 700,
  fontSize: '22px',
  textAlign: 'center',
}
export const cardTextStyle: CSSProperties = {
  fontSize: '14px',
  fontWeight: 600,
  color: 'var(--ink2)',
  marginTop: '8px',
  lineHeight: 1.5,
  textAlign: 'center',
}

/** Settings drawer field label. */
export const labelStyle: CSSProperties = {
  fontSize: '12px',
  fontWeight: 700,
  color: 'var(--ink2)',
  marginBottom: '6px',
}
/** Settings drawer input; the error border colour is the one the drawer uses for invalid fields. */
export const inputStyle = (error: boolean): CSSProperties => ({
  width: '100%',
  height: '46px',
  padding: '0 14px',
  borderRadius: '11px',
  border: '1px solid ' + (error ? '#C2410C' : 'var(--line)'),
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
})
/** Settings drawer inline error text. */
export const errorTextStyle: CSSProperties = { fontSize: '12.5px', fontWeight: 700, color: '#C2410C' }
/** Settings drawer primary button; `busy` uses the Payments sheet's blocked-submit colours (panel3 / ink3). */
export const primaryButtonStyle = (busy: boolean): CSSProperties => ({
  width: '100%',
  height: '50px',
  padding: '0 24px',
  borderRadius: '13px',
  background: busy ? 'var(--panel3)' : 'var(--accent)',
  color: busy ? 'var(--ink3)' : '#fff',
  fontWeight: 800,
  fontSize: '14.5px',
})
/** Settings drawer secondary button (Cancel). */
export const secondaryButtonStyle: CSSProperties = {
  height: '50px',
  padding: '0 18px',
  borderRadius: '13px',
  background: 'var(--panel2)',
  border: '1px solid var(--line)',
  fontWeight: 700,
  fontSize: '14px',
}
/** Payments/Settings toast. */
export const toastStyle: CSSProperties = {
  position: 'fixed',
  bottom: '26px',
  left: '50%',
  transform: 'translateX(-50%)',
  zIndex: 90,
  padding: '14px 20px',
  background: 'var(--ink)',
  color: 'var(--bg)',
  borderRadius: '14px',
  boxShadow: 'var(--shadowLg)',
  fontWeight: 700,
  fontSize: '13.5px',
  maxWidth: '90vw',
}
/** Secondary line under the card (text links). */
export const hintStyle: CSSProperties = {
  fontSize: '12.5px',
  fontWeight: 600,
  color: 'var(--ink3)',
  textAlign: 'center',
}
