// Settings → Oasis AI → Limits & tone (ADR 0174 §3; design §9 tab 4; DEVIATIONS DV-712): what Oasis AI may do and how it
// writes, in the section's working copy (saved by its save bar with the other fields, `capabilities` and `behavior` as
// whole objects). Settings only take abilities away: the capability switches with what each one changes, "Book, move and
// cancel by text" (the section's actionsEnabled), the "Answer questions only" preset, four tone cards with a static
// example reply (no model call), the reply length, what happens to texts in Spanish, three lists (words to avoid, topics
// to avoid, always hand to the team), the owner's style notes (400 characters), an optional sign-off, and the rules that
// are always on, read only. Until the policy wave applies them the tab says they are saved for later (LIMITS_APPLIED).
import {
  ACTIONS_LABEL,
  ALWAYS_ON,
  ANSWER_ONLY_LABEL,
  ANSWER_ONLY_SUB,
  BEHAVIOR_LISTS,
  CAPABILITIES,
  LENGTHS,
  LIMITS_APPLIED,
  LIMITS_PENDING_NOTE,
  SIGN_OFF_MAX,
  SPANISH,
  STYLE_NOTES_MAX,
  TONES,
  isAnswerOnly,
} from '@/lib/settings/assistant'
import type { AssistantFields, BehaviorListKey, CapabilityKey } from '@/lib/settings/assistant'
import { chip, seg, sw } from '@/lib/settings/styles'
import type { InputEvent, KeyEvent, Vals } from './assistant-ctx'
import { bannerStyle, countStyle, inputStyle, textareaStyle } from './assistant-ctx'

/** What the tab needs from the section (live/assistant.ts). */
export interface LimitsHost {
  current(): AssistantFields | undefined
  error(path: string): string
  /** The first error under a path (the server names `behavior.avoidWords.2`). */
  errorUnder(prefix: string): string
  toggle(field: 'enabled' | 'actionsEnabled'): void
  toggleCapability(k: CapabilityKey): void
  answerOnly(): void
  setTone(t: AssistantFields['behavior']['tone']): void
  setLength(l: AssistantFields['behavior']['length']): void
  setSpanish(s: AssistantFields['behavior']['spanish']): void
  setStyleNotes(text: string): void
  setSignOff(text: string): void
  listInput(k: BehaviorListKey): { text: string; error: string }
  setListNew(k: BehaviorListKey, text: string): void
  addListItem(k: BehaviorListKey): void
  removeListItem(k: BehaviorListKey, i: number): void
  view(): { server: { actionsEnabled: boolean } } | undefined
}

const toneCard = (on: boolean): Record<string, string | number> => ({
  display: 'flex',
  flexDirection: 'column',
  gap: '6px',
  textAlign: 'left',
  padding: '14px',
  borderRadius: '14px',
  background: on ? 'var(--accentSoft)' : 'var(--panel)',
  border: '1.5px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
  color: 'var(--ink)',
  minWidth: 0,
})

export function limitsVals(h: LimitsHost): Vals {
  const c = h.current()
  if (!c) return { ready: false, toggles: [], tones: [], lengths: [], spanish: [], lists: [], alwaysOn: [] }
  const v = h.view()
  const toggles = [
    ...CAPABILITIES.map((x) => {
      const w = sw(c.capabilities[x.key])
      return {
        label: x.label,
        sub: x.sub,
        on: c.capabilities[x.key],
        track: w.track,
        knob: w.knob,
        toggle: () => h.toggleCapability(x.key),
      }
    }),
    (() => {
      const w = sw(c.actionsEnabled)
      return {
        label: ACTIONS_LABEL,
        sub:
          'Each booking, move or cancel waits until the client replies with a 4-digit number. Off: a booking link, or a team member, instead.' +
          (v && !v.server.actionsEnabled ? ' It is also off on the server for now.' : ''),
        on: c.actionsEnabled,
        track: w.track,
        knob: w.knob,
        toggle: () => h.toggle('actionsEnabled'),
      }
    })(),
  ]
  const answerOnly = isAnswerOnly(c.capabilities, c.actionsEnabled)
  const b = c.behavior
  const notesErr = h.error('behavior.styleNotes')
  const signErr = h.error('behavior.signOff')
  return {
    ready: true,
    pending: !LIMITS_APPLIED,
    pendingText: LIMITS_PENDING_NOTE,
    pendingStyle: bannerStyle('neutral'),
    toggles,
    answerOnlyLabel: ANSWER_ONLY_LABEL,
    answerOnlySub: answerOnly
      ? 'On: Oasis AI only answers questions. Press again to switch everything back on.'
      : ANSWER_ONLY_SUB,
    answerOnlyStyle: chip(answerOnly),
    answerOnly: () => h.answerOnly(),
    capError: h.errorUnder('capabilities'),
    hasCapError: !!h.errorUnder('capabilities'),
    tones: TONES.map((t) => ({
      label: t.label,
      sub: t.sub,
      example: '“' + t.example + '”',
      style: toneCard(b.tone === t.key),
      onClick: () => h.setTone(t.key),
    })),
    lengths: LENGTHS.map((l) => ({ label: l.label, style: seg(b.length === l.key), onClick: () => h.setLength(l.key) })),
    lengthText: LENGTHS.find((l) => l.key === b.length)?.sub ?? '',
    spanish: SPANISH.map((s) => ({ label: s.label, style: seg(b.spanish === s.key), onClick: () => h.setSpanish(s.key) })),
    spanishText: SPANISH.find((s) => s.key === b.spanish)?.sub ?? '',
    lists: BEHAVIOR_LISTS.map((l) => {
      const input = h.listInput(l.key)
      const serverErr = h.errorUnder('behavior.' + l.key)
      return {
        label: l.label,
        sub: l.sub,
        count: b[l.key].length + ' of ' + l.most,
        items: b[l.key].map((text, i) => ({ text, remove: () => h.removeListItem(l.key, i) })),
        empty: b[l.key].length === 0,
        placeholder: 'For example: ' + l.placeholder,
        value: input.text,
        set: (e: InputEvent) => h.setListNew(l.key, e.target.value),
        keys: (e: KeyEvent) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            h.addListItem(l.key)
          }
        },
        add: () => h.addListItem(l.key),
        error: input.error || serverErr,
        hasError: !!(input.error || serverErr),
        inputStyle: inputStyle(!!input.error),
      }
    }),
    styleNotes: b.styleNotes,
    setStyleNotes: (e: InputEvent) => h.setStyleNotes(e.target.value),
    styleNotesStyle: textareaStyle(!!notesErr, 3),
    styleNotesCount: b.styleNotes.length + ' / ' + STYLE_NOTES_MAX,
    styleNotesCountStyle: countStyle(b.styleNotes.length > STYLE_NOTES_MAX),
    styleNotesError: notesErr,
    hasStyleNotesError: !!notesErr,
    signOff: b.signOff,
    setSignOff: (e: InputEvent) => h.setSignOff(e.target.value),
    signOffStyle: inputStyle(!!signErr),
    signOffCount: b.signOff.trim().length + ' / ' + SIGN_OFF_MAX,
    signOffCountStyle: countStyle(b.signOff.trim().length > SIGN_OFF_MAX),
    signOffError: signErr,
    hasSignOffError: !!signErr,
    alwaysOn: ALWAYS_ON.map((text) => ({ text })),
  }
}
