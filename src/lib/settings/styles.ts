// Inline style objects of the Settings template; key order and values copied from the design.
import { AVATAR_COLORS } from './constants'
import type { Closure, EmployeeStatus, SectionKey, StyleObject } from './types'

export interface SwitchStyle {
  track: StyleObject
  knob: StyleObject
}

export const sw = (on: boolean): SwitchStyle => ({
  track: {
    flex: 'none',
    width: '50px',
    height: '30px',
    borderRadius: '16px',
    position: 'relative',
    background: on ? 'var(--accent)' : 'var(--line)',
    transition: 'background .15s',
  },
  knob: {
    position: 'absolute',
    top: '3px',
    left: on ? '23px' : '3px',
    width: '24px',
    height: '24px',
    borderRadius: '50%',
    background: '#fff',
    boxShadow: '0 1px 3px rgba(0,0,0,.25)',
    transition: 'left .15s',
  },
})

export const seg = (on: boolean): StyleObject => ({
  flex: 1,
  height: '38px',
  padding: '0 12px',
  borderRadius: '9px',
  fontSize: '13px',
  fontWeight: 700,
  whiteSpace: 'nowrap',
  background: on ? 'var(--accent)' : 'transparent',
  color: on ? '#fff' : 'var(--ink2)',
})

export const chip = (on: boolean): StyleObject => ({
  height: '40px',
  padding: '0 14px',
  borderRadius: '11px',
  fontSize: '13px',
  fontWeight: 700,
  background: on ? 'var(--accentSoft)' : 'var(--panel)',
  color: on ? 'var(--accentInk)' : 'var(--ink2)',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
})

export const navStyle = (current: SectionKey, key: SectionKey): StyleObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: '11px',
  width: '100%',
  minHeight: '44px',
  padding: '0 12px',
  borderRadius: '12px',
  fontSize: '14px',
  fontWeight: 700,
  background: current === key ? 'var(--accentSoft)' : 'transparent',
  color: current === key ? 'var(--accentInk)' : 'var(--ink2)',
})

export const closureTagStyle = (c: Pick<Closure, 'emergency' | 'type'>): StyleObject => ({
  fontSize: '11px',
  fontWeight: 800,
  padding: '3px 8px',
  borderRadius: '7px',
  background: c.emergency
    ? 'rgba(194,65,12,.14)'
    : c.type === 'closed'
      ? 'var(--panel3)'
      : 'var(--accentSoft)',
  color: c.emergency ? '#C2410C' : c.type === 'closed' ? 'var(--ink2)' : 'var(--accentInk)',
})

export const avatarStyle = (i: number, size: number, dark: boolean): StyleObject => ({
  width: size + 'px',
  height: size + 'px',
  borderRadius: '13px',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  fontWeight: 800,
  fontSize: size / 3.2 + 'px',
  background: 'color-mix(in oklab, ' + AVATAR_COLORS[i % 7] + ' ' + (dark ? '26%' : '15%') + ', transparent)',
  color: dark ? '#E8EEEA' : AVATAR_COLORS[i % 7]!,
})

export const employeeStatusStyle = (st: EmployeeStatus): StyleObject => ({
  width: '96px',
  textAlign: 'center',
  fontSize: '11.5px',
  fontWeight: 800,
  padding: '5px 9px',
  borderRadius: '8px',
  background:
    st === 'active' ? 'var(--accentSoft)' : st === 'invited' ? 'rgba(194,116,11,.14)' : 'var(--panel3)',
  color: st === 'active' ? 'var(--accentInk)' : st === 'invited' ? '#B45309' : 'var(--ink3)',
})

export const matrixBoxStyle = (on: boolean, locked: boolean): StyleObject => ({
  width: '36px',
  height: '36px',
  borderRadius: '10px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  background: on ? (locked ? 'var(--panel3)' : 'var(--accent)') : 'transparent',
  color: on ? (locked ? 'var(--ink2)' : '#fff') : 'transparent',
  border: on ? 'none' : '2px solid var(--line)',
  cursor: locked ? 'not-allowed' : 'pointer',
})

export const limitChipStyle = (locked: boolean): StyleObject => ({
  fontSize: '11px',
  fontWeight: 800,
  padding: '3px 7px',
  borderRadius: '6px',
  background: 'var(--panel2)',
  border: '1px solid var(--line)',
  color: 'var(--ink2)',
  whiteSpace: 'nowrap',
  cursor: locked ? 'not-allowed' : 'pointer',
})

export const serviceKindStyle = (isPkg: boolean): StyleObject => ({
  fontSize: '10.5px',
  fontWeight: 800,
  padding: '4px 8px',
  borderRadius: '6px',
  textTransform: 'uppercase',
  letterSpacing: '0.04em',
  background: isPkg ? 'var(--accentSoft)' : 'rgba(176,121,8,.15)',
  color: isPkg ? 'var(--accentInk)' : '#8A5A06',
})

export const serviceRowStyle = (selected: boolean): StyleObject => ({
  display: 'flex',
  alignItems: 'center',
  gap: '8px',
  width: '100%',
  minHeight: '44px',
  padding: '0 12px',
  borderRadius: '10px',
  background: selected ? 'var(--panel)' : 'transparent',
  border: '1px solid ' + (selected ? 'var(--line)' : 'transparent'),
  color: selected ? 'var(--ink)' : 'var(--ink2)',
})

export const drawerFieldStyle = (invalid: boolean): StyleObject => ({
  width: '100%',
  height: '46px',
  padding: '0 14px',
  borderRadius: '11px',
  border: '1px solid ' + (invalid ? '#C2410C' : 'var(--line)'),
  background: 'var(--panel)',
  color: 'var(--ink)',
  fontFamily: 'inherit',
  fontSize: '14px',
  fontWeight: 600,
})

export const drawerTabStyle = (active: boolean): StyleObject => ({
  height: '44px',
  padding: '0 16px',
  fontSize: '14px',
  fontWeight: 700,
  color: active ? 'var(--accentInk)' : 'var(--ink2)',
  borderBottom: '3px solid ' + (active ? 'var(--accent)' : 'transparent'),
})

export const overrideButtonStyle = (on: boolean, color: string): StyleObject => ({
  height: '30px',
  padding: '0 10px',
  borderRadius: '7px',
  fontSize: '11.5px',
  fontWeight: 800,
  background: on ? color : 'transparent',
  color: on ? '#fff' : 'var(--ink3)',
})

export const roleOptionStyle = (on: boolean): StyleObject => ({
  display: 'flex',
  alignItems: 'flex-start',
  gap: '10px',
  padding: '12px',
  borderRadius: '12px',
  minHeight: '60px',
  background: on ? 'var(--accentSoft)' : 'var(--panel)',
  border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
})

export const roleOptionBoxStyle = (on: boolean): StyleObject => ({
  width: '22px',
  height: '22px',
  borderRadius: '7px',
  flex: 'none',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  marginTop: '1px',
  background: on ? 'var(--accent)' : 'transparent',
  border: on ? 'none' : '2px solid var(--ink3)',
})

export const effDotStyle = (on: boolean): StyleObject => ({
  width: '10px',
  height: '10px',
  borderRadius: '50%',
  flex: 'none',
  background: on ? 'var(--accent)' : 'var(--line)',
})
