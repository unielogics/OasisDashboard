// Thresholds and decisions of the touch/pointer gesture engine. The class owns the listeners, timers and DOM writes;
// this module only answers "what does this movement mean" so the numbers are tested in one place.

export const LONG_PRESS_MS = 380
export const MOUSE_DRAG_PX = 6
export const TOUCH_INTENT_PX = 12
export const TOUCH_INTENT_RATIO = 1.4
export const SWIPE_COMMIT_PX = 90
export const SWIPE_CLAMP_PX = 150
export const CLICK_SUPPRESS_MS = 450
export const CAL_SWIPE_PX = 70
export const CAL_SWIPE_RATIO = 1.5
export const CAL_SWIPE_MS = 800

export type GestureCtx = 'tl' | 'q' | 'cal'

export type MoveDecision =
  /** Mouse past the 6 px threshold on a draggable card: start dragging. */
  | 'begin-drag'
  /** Touch moved horizontally on a timeline card: swipe mode (the long-press timer is cancelled). */
  | 'swipe'
  /** Touch moved horizontally on another card, or more than 12 px otherwise: give the gesture back to scrolling. */
  | 'end'
  /** Nothing decided yet. */
  | 'idle'

export interface MoveInput {
  touch: boolean
  can: boolean
  ctx: GestureCtx | string
  dx: number
  dy: number
}

/** The undecided phase of pointermove (no mode yet). `cancelTimer` says whether the long-press timer is cleared. */
export function decideMove({ touch, can, ctx, dx, dy }: MoveInput): {
  decision: MoveDecision
  cancelTimer: boolean
} {
  if (!touch) {
    return { decision: can && Math.hypot(dx, dy) > MOUSE_DRAG_PX ? 'begin-drag' : 'idle', cancelTimer: false }
  }
  if (Math.abs(dx) > TOUCH_INTENT_PX && Math.abs(dx) > Math.abs(dy) * TOUCH_INTENT_RATIO) {
    return { decision: ctx === 'tl' ? 'swipe' : 'end', cancelTimer: true }
  }
  if (Math.hypot(dx, dy) > TOUCH_INTENT_PX) return { decision: 'end', cancelTimer: false }
  return { decision: 'idle', cancelTimer: false }
}

/** The card follows the finger, clamped to +-150 px. */
export const clampSwipe = (dx: number): number => Math.max(-SWIPE_CLAMP_PX, Math.min(SWIPE_CLAMP_PX, dx))

export const swipeTransform = (dx: number): string => 'translateX(' + clampSwipe(dx) + 'px)'

export type SwipeOutcome = 'advance' | 'messages' | 'none'

/** Release of a timeline swipe: right past 90 px advances, left past 90 px opens Messages. */
export function swipeOutcome(dx: number): SwipeOutcome {
  if (dx > SWIPE_COMMIT_PX) return 'advance'
  if (dx < -SWIPE_COMMIT_PX) return 'messages'
  return 'none'
}

/** Ghost card position while dragging (offset so the pointer sits near its top middle). */
export const ghostTransform = (x: number, y: number): string =>
  'translate(' + (x - 140) + 'px,' + (y - 36) + 'px) rotate(-2deg)'

/** A click right after a gesture must not open the file. `sup` is the epoch ms of the last gesture (0 if none). */
export const clickSuppressed = (nowMs: number, sup: number | undefined): boolean =>
  nowMs - (sup || 0) < CLICK_SUPPRESS_MS

/** Calendar swipe: +1 (next) for a left swipe, -1 for a right swipe, 0 when it does not qualify. */
export function calendarSwipe(dx: number, dy: number, elapsedMs: number): -1 | 0 | 1 {
  if (
    Math.abs(dx) > CAL_SWIPE_PX &&
    Math.abs(dx) > Math.abs(dy) * CAL_SWIPE_RATIO &&
    elapsedMs < CAL_SWIPE_MS
  ) {
    return dx < 0 ? 1 : -1
  }
  return 0
}
