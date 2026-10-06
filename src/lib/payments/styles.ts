// Inline style objects of the Payments template, key order and values copied from the design.
import type { StyleObject } from './types'

export const seg = (on: boolean): StyleObject => ({
  flex: 1,
  height: '40px',
  padding: '0 12px',
  borderRadius: '9px',
  fontSize: '13px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? '#fff' : 'var(--ink2)',
})

export const chip = (on: boolean): StyleObject => ({
  height: '38px',
  padding: '0 13px',
  borderRadius: '10px',
  fontSize: '12.5px',
  fontWeight: 700,
  background: on ? 'var(--accentSoft)' : 'var(--panel)',
  color: on ? 'var(--accentInk)' : 'var(--ink2)',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
})

export const unitSeg = (on: boolean): StyleObject => ({ ...seg(on), flex: 'none', width: '48px' })

export const rangeButtonStyle = (on: boolean): StyleObject => ({
  height: '38px',
  padding: '0 14px',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 700,
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? '#fff' : 'var(--ink2)',
})

export const filterChipStyle = (on: boolean): StyleObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: '7px',
  height: '38px',
  padding: '0 12px',
  borderRadius: '10px',
  fontSize: '13px',
  fontWeight: 700,
  background: on ? 'var(--accentSoft)' : 'transparent',
  color: on ? 'var(--accentInk)' : 'var(--ink2)',
})

export const filterCountStyle = (on: boolean): StyleObject => ({
  fontSize: '11px',
  fontWeight: 800,
  padding: '1px 6px',
  borderRadius: '6px',
  background: on ? 'var(--accent)' : 'var(--panel3)',
  color: on ? '#fff' : 'var(--ink3)',
})

export const rowStyle = (selected: boolean): StyleObject => ({
  display: 'grid',
  gridTemplateColumns: '118px minmax(170px,1.4fr) minmax(140px,1.2fr) 96px 150px',
  gap: '12px',
  alignItems: 'center',
  width: '100%',
  textAlign: 'left',
  minHeight: '58px',
  padding: '9px 16px',
  borderBottom: '1px solid var(--line2)',
  background: selected ? 'var(--accentSoft)' : 'transparent',
})

export const roleOptionStyle = (selected: boolean): StyleObject => ({
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: '1px',
  width: '100%',
  padding: '9px 10px',
  borderRadius: '10px',
  background: selected ? 'var(--accentSoft)' : 'transparent',
})

export const netBarStyle = (net: number, max: number): StyleObject => ({
  height: (net / max) * 100 + '%',
  minHeight: net > 0 ? '3px' : '0',
  background: 'var(--accent)',
  borderRadius: '4px 4px 2px 2px',
})

export const lossBarStyle = (loss: number, max: number): StyleObject => ({
  height: (loss / max) * 100 + '%',
  background: 'var(--red)',
  borderRadius: '3px',
  opacity: 0.85,
})

export const methodBarStyle = (label: string, value: number, max: number): StyleObject => ({
  height: '100%',
  width: (value / max) * 100 + '%',
  background: label === 'Store credit' ? 'var(--amber)' : 'var(--accent)',
  borderRadius: '4px',
})

export type LineKind = 'total' | 'neg' | 'pos' | null | undefined

export function lineStyles(kind: LineKind): {
  style: StyleObject
  labelStyle: StyleObject
  valStyle: StyleObject
} {
  return {
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      padding: kind === 'total' ? '11px 0 7px' : '6px 0',
      borderTop: kind === 'total' ? '1px solid var(--line)' : 'none',
      marginTop: kind === 'total' ? '4px' : '0',
    },
    labelStyle: {
      fontSize: kind === 'total' ? '14px' : '13px',
      fontWeight: kind === 'total' ? 800 : 600,
      color: kind === 'neg' ? 'var(--red)' : kind === 'pos' ? 'var(--accentInk)' : 'var(--ink2)',
    },
    valStyle: {
      fontSize: kind === 'total' ? '15px' : '13px',
      fontWeight: 800,
      color: kind === 'neg' ? 'var(--red)' : kind === 'pos' ? 'var(--accentInk)' : 'var(--ink)',
    },
  }
}

export const actionStyle = (ok: boolean, primary: boolean): StyleObject => ({
  height: '48px',
  borderRadius: '12px',
  fontWeight: 800,
  fontSize: '13.5px',
  background: !ok ? 'var(--panel2)' : primary ? 'var(--accent)' : 'var(--panel)',
  color: !ok ? 'var(--ink3)' : primary ? '#fff' : 'var(--ink)',
  border: '1px solid ' + (primary && ok ? 'var(--accent)' : 'var(--line)'),
  opacity: ok ? 1 : 0.7,
})

export const ledgerDotStyle = (pending: boolean, color: string): StyleObject => ({
  width: '30px',
  height: '30px',
  borderRadius: '9px',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  fontSize: '14px',
  background: pending ? 'var(--amberSoft)' : 'var(--panel2)',
  border: '1px solid var(--line)',
  color: pending ? 'var(--amber)' : color,
})

export const approveButtonStyle = (canApprove: boolean): StyleObject => ({
  height: '34px',
  padding: '0 13px',
  borderRadius: '9px',
  background: canApprove ? 'var(--accent)' : 'var(--panel3)',
  color: canApprove ? '#fff' : 'var(--ink3)',
  fontWeight: 800,
  fontSize: '12px',
})

export const itemRowStyle = (on: boolean): StyleObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: '11px',
  minHeight: '50px',
  padding: '0 14px',
  borderRadius: '12px',
  background: on ? 'var(--accentSoft)' : 'var(--panel)',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
})

export const itemBoxStyle = (on: boolean): StyleObject => ({
  width: '22px',
  height: '22px',
  borderRadius: '7px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  flex: 'none',
  background: on ? 'var(--accent)' : 'transparent',
  border: on ? 'none' : '2px solid var(--ink3)',
})

export const permBoxStyle = (ok: boolean): StyleObject => ({
  padding: '12px 14px',
  borderRadius: '12px',
  fontSize: '12.5px',
  fontWeight: 700,
  lineHeight: 1.45,
  background: ok ? 'var(--accentSoft)' : 'var(--amberSoft)',
  color: ok ? 'var(--accentInk)' : 'var(--amber)',
  border: '1px solid ' + (ok ? 'var(--accentBrd)' : 'var(--line)'),
})

export const submitStyle = (blocked: boolean, kind: string): StyleObject => ({
  flex: 1,
  height: '52px',
  borderRadius: '13px',
  fontWeight: 800,
  fontSize: '15px',
  background: blocked ? 'var(--panel3)' : kind === 'refund' ? 'var(--red)' : 'var(--accent)',
  color: blocked ? 'var(--ink3)' : '#fff',
})
