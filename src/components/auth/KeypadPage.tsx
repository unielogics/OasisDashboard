// The kiosk keypad (ADR 0180 and its 2026-10-14 amendment, design 6.1; DEVIATIONS DV-1001): the sign-in page while kiosk
// mode is on (the default). Any listed employee's own 8-digit PIN, typed on the shop's network, opens the board for the whole
// shop; typing 0218 as the first four digits swaps in the email/password card at once (nothing is sent). Away from the shop
// (GET /kiosk/status `atShop` false), or before a Super Admin set the shop network (`networkSet` false), the keypad still
// shows, says so and sends no PIN; while so it reads the status again (every 30 s, when the page comes back into view and
// before acting on a full PIN), so the tablet is ready by itself once the Super Admin added the network from a phone (review
// F1). One exception (review F2): a browser that opened the kiosk before sends one PIN per page from a new network, so the
// server lists the try for the Super Admin ("PIN tried from a new network"); the server never checks it. Built from the sign-in page's own primitives (AuthFrame, the Payments locked card,
// the design's button colours); keys are 76 px tall for gloved, wet or hurried fingers, and the physical keyboard works too.
//
// The PIN is never stored or logged: it lives in this component's state until it is sent, and is cleared right after.
import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import {
  EMPTY_KEYPAD,
  KEYPAD_TEXT,
  PIN_LENGTH,
  RECHECK_MS,
  blockText,
  isComplete,
  keyOf,
  keypadBlock,
  lockedToast,
  mayTryFromHere,
  openedHere,
  press,
  rememberOpenedHere,
  revealsForm,
  unlockProblem,
  waitText,
} from '@/auth/keypad'
import type { KeypadBlock, KeypadKey, KeypadState } from '@/auth/keypad'
import type { KioskStatus } from '@/data/http/auth-types'
import type { AuthApi, KioskApi } from '@/data/http/endpoints'
import { serverNow } from '@/lib/clock'
import { AuthFrame } from './Frame'
import { Card, linkRowStyle } from './Card'
import { EmailPasswordCard } from './EmailPasswordCard'
import { Toast } from './Toast'
import { errorTextStyle } from './styles'

export interface KeypadQuery {
  next?: string | string[]
  locked?: string | string[]
  at?: string | string[]
  expired?: string | string[]
  admin?: string | string[]
}

interface Props {
  status: KioskStatus
  kiosk: Pick<KioskApi, 'unlock' | 'status'>
  auth: AuthApi
  query: KeypadQuery
  /** Full-page navigation (replaced in tests). */
  navigate: (url: string) => void
  /** Seconds clock for the countdown (replaced in tests). */
  now?: () => number
  /** How often a blocked keypad reads GET /kiosk/status again (replaced in tests). */
  recheckMs?: number
}

const KEYS: ReadonlyArray<KeypadKey> = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'clear', '0', 'back']

const keyStyle = (kind: 'digit' | 'action', disabled: boolean): CSSProperties => ({
  height: '76px',
  borderRadius: '16px',
  background: kind === 'digit' ? 'var(--panel)' : 'var(--panel2)',
  border: '1px solid var(--line)',
  color: disabled ? 'var(--ink3)' : 'var(--ink)',
  fontFamily: kind === 'digit' ? "'Bricolage Grotesque',sans-serif" : 'inherit',
  fontWeight: kind === 'digit' ? 700 : 800,
  fontSize: kind === 'digit' ? '26px' : '14px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
})

const dotStyle = (on: boolean): CSSProperties => ({
  width: '16px',
  height: '16px',
  borderRadius: '50%',
  background: on ? 'var(--accent)' : 'transparent',
  border: '2px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
})

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v)

export function KeypadPage({ status, kiosk, auth, query, navigate, now = serverNow, recheckMs = RECHECK_MS }: Props) {
  const [kp, setKp] = useState<KeypadState>(EMPTY_KEYPAD)
  const [form, setForm] = useState(false)
  const [busy, setBusy] = useState(false)
  // no shop network yet, or this connection is not one: no PIN is ever sent from here (0218 still works)
  const [block, setBlock] = useState<KeypadBlock | null>(() => keypadBlock(status))
  const [message, setMessage] = useState<string>(() => {
    const b = keypadBlock(status)
    return b ? blockText(b) : status.lockedOut ? KEYPAD_TEXT.lockedOut : ''
  })
  const [lockedOut, setLockedOut] = useState(status.lockedOut)
  const [waitUntil, setWaitUntil] = useState(status.retryAfterSec > 0 ? now() + status.retryAfterSec * 1000 : 0)
  const [, tick] = useState(0)
  const [toast, setToast] = useState<string | null>(() =>
    lockedToast({ locked: first(query.locked), at: first(query.at), expired: first(query.expired) }),
  )
  const clearToast = useCallback(() => setToast(null), [])
  const sending = useRef(false)
  const blockRef = useRef(block)
  blockRef.current = block
  // this page already sent its one PIN from a new network (review F2)
  const triedHere = useRef(false)
  // the full PIN the status was read again for (a blocked keypad reads it once before acting on a PIN)
  const checkedKp = useRef<KeypadState | null>(null)
  const reading = useRef<Promise<void> | null>(null)
  const alive = useRef(true)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  const waitSec = waitUntil > 0 ? Math.max(0, Math.ceil((waitUntil - now()) / 1000)) : 0
  const waiting = waitSec > 0

  // the countdown ticks once a second while it runs
  useEffect(() => {
    if (!waiting) return
    const t = setInterval(() => tick((n) => n + 1), 250)
    return () => clearInterval(t)
  }, [waiting])

  // a fresh GET /kiosk/status: the network may have been added (or approved) meanwhile, or kiosk mode switched off
  const applyStatus = useCallback(
    (s: KioskStatus) => {
      if (!s.enabled) {
        setMessage(KEYPAD_TEXT.off)
        setToast(KEYPAD_TEXT.off)
        setForm(true)
        return
      }
      const b = keypadBlock(s)
      if (blockRef.current && !b) setToast(KEYPAD_TEXT.ready)
      blockRef.current = b
      setBlock(b)
      setLockedOut(s.lockedOut)
      setWaitUntil(s.retryAfterSec > 0 ? now() + s.retryAfterSec * 1000 : 0)
      setMessage(b ? blockText(b) : s.lockedOut ? KEYPAD_TEXT.lockedOut : '')
    },
    [now],
  )

  const recheck = useCallback((): Promise<void> => {
    if (!reading.current)
      reading.current = kiosk
        .status()
        .then((s) => {
          if (alive.current) applyStatus(s)
        })
        // unreadable (offline): the keypad stays as it is
        .catch(() => undefined)
        .finally(() => {
          reading.current = null
        })
    return reading.current
  }, [kiosk, applyStatus])

  const recheckThenAct = useCallback(async () => {
    setBusy(true)
    await recheck()
    if (alive.current) setBusy(false)
  }, [recheck])

  const submit = useCallback(
    async (pin: string) => {
      if (sending.current) return
      sending.current = true
      setBusy(true)
      setMessage('')
      try {
        await kiosk.unlock(pin)
        rememberOpenedHere()
        navigate('/operations')
        return
      } catch (err) {
        const p = unlockProblem(err)
        setMessage(p.text)
        if (p.lockedOut) setLockedOut(true)
        if (p.block) setBlock(p.block)
        setWaitUntil(p.waitSec > 0 ? now() + p.waitSec * 1000 : 0)
        if (p.showForm) {
          setToast(p.text)
          setForm(true)
        }
      } finally {
        // the PIN is gone from the page either way
        setKp(EMPTY_KEYPAD)
        setBusy(false)
        sending.current = false
      }
    },
    [kiosk, navigate, now],
  )

  // a full PIN goes out by itself, unless this connection is not the shop's, the keypad must wait or is locked out
  useEffect(() => {
    if (form || !isComplete(kp) || busy) return
    if (block) {
      // read the status first: the shop network may exist now (this effect runs again when the read is done)
      if (checkedKp.current !== kp) {
        checkedKp.current = kp
        void recheckThenAct()
        return
      }
      checkedKp.current = null
      if (mayTryFromHere(block, { openedHere: openedHere(), triedHere: triedHere.current })) {
        // a browser that opened the kiosk before: one try, so the Super Admin sees it (the server never checks the PIN)
        triedHere.current = true
        void submit(kp.digits)
        return
      }
      setMessage(blockText(block))
      setKp(EMPTY_KEYPAD)
      return
    }
    checkedKp.current = null
    if (lockedOut) {
      setMessage(KEYPAD_TEXT.lockedOut)
      setKp(EMPTY_KEYPAD)
      return
    }
    if (waiting) return // sent when the countdown ends
    void submit(kp.digits)
  }, [kp, form, busy, lockedOut, waiting, block, submit, recheckThenAct])

  // while blocked: read the status again now and then, and whenever the page comes back into view or online
  useEffect(() => {
    if (!block || form) return
    const again = () => {
      if (document.visibilityState !== 'hidden' && !sending.current) void recheck()
    }
    const t = setInterval(again, recheckMs)
    window.addEventListener('focus', again)
    window.addEventListener('online', again)
    document.addEventListener('visibilitychange', again)
    return () => {
      clearInterval(t)
      window.removeEventListener('focus', again)
      window.removeEventListener('online', again)
      document.removeEventListener('visibilitychange', again)
    }
  }, [block, form, recheck, recheckMs])

  // the latest keypad, so keys pressed faster than React renders still add up
  const kpRef = useRef(kp)
  kpRef.current = kp
  const onKey = useCallback(
    (key: KeypadKey) => {
      if (busy) return
      const next = press(kpRef.current, key)
      if (revealsForm(next)) {
        // 0218: the email/password card at once; nothing is sent
        kpRef.current = EMPTY_KEYPAD
        setKp(EMPTY_KEYPAD)
        setMessage('')
        setForm(true)
        return
      }
      kpRef.current = next
      setKp(next)
    },
    [busy],
  )

  useEffect(() => {
    if (form) return
    const h = (e: KeyboardEvent) => {
      const k = keyOf(e)
      if (!k) return
      e.preventDefault()
      onKey(k)
    }
    window.addEventListener('keydown', h)
    return () => window.removeEventListener('keydown', h)
  }, [form, onKey])

  if (form)
    return (
      <AuthFrame>
        <EmailPasswordCard
          auth={auth}
          next={query.next}
          navigate={navigate}
          onBack={() => {
            setForm(false)
            setKp(EMPTY_KEYPAD)
            // a keypad that may not send still says why (0218 cleared the line)
            setMessage(block ? blockText(block) : lockedOut ? KEYPAD_TEXT.lockedOut : '')
          }}
        />
        <Toast text={toast} onDone={clearToast} />
      </AuthFrame>
    )

  const line = waiting ? waitText(waitSec) : ''
  return (
    <AuthFrame>
      <Card title={KEYPAD_TEXT.title} text={KEYPAD_TEXT.subtitle}>
        <div
          role="group"
          aria-label={`PIN, ${kp.digits.length} of ${PIN_LENGTH} digits`}
          style={{ display: 'flex', justifyContent: 'center', gap: '12px', margin: '2px 0 18px' }}
        >
          {Array.from({ length: PIN_LENGTH }, (_, i) => (
            <span key={i} data-dot={i < kp.digits.length ? 'on' : 'off'} style={dotStyle(i < kp.digits.length)} />
          ))}
        </div>
        <div
          role="alert"
          style={{ ...errorTextStyle, minHeight: '36px', textAlign: 'center', lineHeight: 1.45, marginBottom: '10px' }}
        >
          {message}
          {message && line ? <br /> : null}
          {line}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: '10px' }}>
          {KEYS.map((k) => (
            <button
              key={k}
              type="button"
              data-key={k}
              disabled={busy}
              aria-label={k === 'back' ? 'Delete' : k === 'clear' ? 'Clear' : k}
              onClick={() => onKey(k)}
              style={keyStyle(k === 'clear' || k === 'back' ? 'action' : 'digit', busy)}
            >
              {k === 'clear' ? (
                'Clear'
              ) : k === 'back' ? (
                <svg width="26" height="26" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                  <path d="M9 5h11v14H9l-6-7z" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
                  <path d="M12 9.5l5 5M17 9.5l-5 5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                </svg>
              ) : (
                k
              )}
            </button>
          ))}
        </div>
        {status.unlocked && (
          <div style={linkRowStyle}>
            <a href="/operations">Back to the board</a>
          </div>
        )}
      </Card>
      <Toast text={toast} onDone={clearToast} />
    </AuthFrame>
  )
}
