// Settings → Oasis AI → Practice (ADR 0174 §4, §5; design §9 tab 3; DEVIATIONS DV-711). The owner texts Oasis AI as a
// client; the real pipeline answers, minus side effects (nothing is sent, booked or saved to a client). Persona: a new
// texter, or a client on file (read only; needs "View client files") verified or not. Sessions are the person's own. A
// turn runs as a job on the server: the tab reads the session again every 2 s while one runs, and the event stream's
// `assistant.practice.turn` refetches it at once. Each answer shows its badges ("Rewritten", "Booking link", "Handed to the
// team"), the link markers as chips and the confirmation it would text; "Correct this answer" opens the correction dialog,
// then "Try again" re-runs that text as an alternate turn ("After your correction"). Banners when practice is off on the
// server or the day's practice budget is used. Until wave K2c the routes answer 501: the tab says "coming soon".
import type { ApiError } from '@/data/http/problem'
import { newIdempotencyKey } from '@/lib/id'
import type {
  AssistantPracticeApi,
  ClientHit,
  PracticeDetail,
  PracticeList,
  PracticeTurn,
} from '@/data/ports/assistant-practice-api'
import {
  POLL_MS,
  PRACTICE_EXPLAIN,
  PRACTICE_TEXT_MAX,
  badgeTone,
  personaLine,
  practiceBanners,
  practiceBlocked,
  replyParts,
  turnNote,
  turnsLabel,
  usd,
  whenLabel,
} from '@/lib/settings/assistant-practice'
import { chipStyle } from '@/lib/settings/assistant-knowledge'
import { seg, sw } from '@/lib/settings/styles'
import type { AiCtx, InputEvent, KeyEvent, Vals } from './assistant-ctx'
import {
  bannerStyle,
  countStyle,
  ghostStyle,
  inputStyle,
  isNotBuilt,
  listRowStyle,
  primaryStyle,
  problemText,
  run,
  settingsKey,
  textareaStyle,
} from './assistant-ctx'
import type { CorrectionDialog } from './assistant-correction'

export const PRACTICE_KEY = settingsKey('assistant_practice')
const sessionKey = (id: string): readonly unknown[] => ['assistant_practice', id]
const DENY = 'change the Oasis AI settings'
const DENIED = 'Your role can’t change the Oasis AI settings'
const SEARCH_MS = 300

export class PracticeSection {
  private persona: 'new_texter' | 'client' = 'new_texter'
  private verified = true
  private spanish = false
  private clientQuery = ''
  private hits: ClientHit[] = []
  private client: ClientHit | null = null
  private searchTimer: unknown = null
  private current: string | null = null
  private draft = ''
  private sending = false
  private starting = false
  private error = ''
  private confirming: string | null = null
  /** Turns corrected from this page: "Try again" shows under them. */
  private corrected = new Set<string>()
  private poll: unknown = null

  constructor(
    private readonly ctx: AiCtx,
    private readonly api: AssistantPracticeApi | undefined,
    private readonly correction: CorrectionDialog,
  ) {}

  private allowed(): boolean {
    if (this.ctx.can('set.assistant')) return true
    this.ctx.emit({ title: DENIED })
    return false
  }

  list(): PracticeList | undefined {
    const api = this.api
    if (!api || !this.ctx.can('set.assistant')) return undefined
    return this.ctx.read(['assistant_practice'], () => api.sessions())
  }

  detail(id: string): PracticeDetail | undefined {
    const api = this.api
    if (!api) return undefined
    return this.ctx.read(sessionKey(id), () => api.session(id))
  }

  state(): 'locked' | 'loading' | 'failed' | 'soon' | 'ready' {
    if (!this.api || !this.ctx.can('set.assistant')) return 'locked'
    if (this.list()) return 'ready'
    const st = this.ctx.status(['assistant_practice'])
    if (st !== 'error') return 'loading'
    return isNotBuilt(this.ctx.error(['assistant_practice'])) ? 'soon' : 'failed'
  }

  private refreshSession(id: string): void {
    void this.ctx.qc.invalidateQueries({ queryKey: settingsKey(...sessionKey(id)) })
  }

  /** Reads the open session again while one of its turns runs, only while the tab is on screen. */
  private schedulePoll(d: PracticeDetail | undefined, visible: boolean): void {
    const running = !!d?.turns.some((t) => t.status === 'running')
    if (!visible || !running) {
      if (this.poll !== null) this.ctx.timers.clear(this.poll)
      this.poll = null
      return
    }
    if (this.poll !== null) return
    const id = d!.session.id
    this.poll = this.ctx.timers.set(() => {
      this.poll = null
      this.refreshSession(id)
    }, POLL_MS)
  }

  stop(): void {
    if (this.poll !== null) this.ctx.timers.clear(this.poll)
    this.poll = null
    if (this.searchTimer !== null) this.ctx.timers.clear(this.searchTimer)
    this.searchTimer = null
  }

  // ---- the persona picker -------------------------------------------------------------------------------------------------

  setPersona(p: 'new_texter' | 'client'): void {
    if (p === 'client' && !this.ctx.can('cli.view')) {
      this.ctx.emit({ title: 'Your role can’t view client files' })
      return
    }
    this.persona = p
    this.error = ''
    this.ctx.changed()
  }

  setClientQuery(q: string): void {
    this.clientQuery = q
    this.client = null
    if (this.searchTimer !== null) this.ctx.timers.clear(this.searchTimer)
    this.searchTimer = null
    const api = this.api
    if (!api || q.trim().length < 2) {
      this.hits = []
      this.ctx.changed()
      return
    }
    this.searchTimer = this.ctx.timers.set(() => {
      this.searchTimer = null
      api.findClients(q.trim()).then(
        (hits) => {
          if (this.clientQuery === q) {
            this.hits = hits
            this.ctx.changed()
          }
        },
        () => {
          this.hits = []
          this.ctx.changed()
        },
      )
    }, SEARCH_MS)
    this.ctx.changed()
  }

  pickClient(c: ClientHit): void {
    this.client = c
    this.clientQuery = c.fullName
    this.hits = []
    this.ctx.changed()
  }

  async start(): Promise<boolean> {
    const api = this.api
    if (!api || this.starting || !this.allowed()) return false
    if (this.persona === 'client' && !this.client) {
      this.error = 'Find the client first: type a name or a number.'
      this.ctx.changed()
      return false
    }
    this.starting = true
    this.error = ''
    this.ctx.changed()
    const body = {
      persona: this.persona,
      language: this.spanish ? ('es' as const) : ('en' as const),
      ...(this.persona === 'client' ? { customerId: this.client!.id, verified: this.verified } : {}),
    }
    const r = await run(this.ctx, {
      key: PRACTICE_KEY,
      request: (idem) => api.createSession(body, { idempotencyKey: idem }),
      denyLabel: DENY,
    })
    this.starting = false
    if (r.ok) {
      this.current = r.data.session.id
      this.draft = ''
    } else if (r.error.status === 409 || r.error.status === 422 || r.error.status === 429 || isNotBuilt(r.error))
      this.error = problemText(r.error)
    this.ctx.changed()
    return r.ok
  }

  pick(id: string): void {
    this.current = id
    this.error = ''
    this.draft = ''
    this.ctx.changed()
  }

  newSession(): void {
    this.current = null
    this.error = ''
    this.ctx.changed()
  }

  async remove(id: string): Promise<void> {
    const api = this.api
    if (!api || !this.allowed()) return
    this.confirming = null
    const r = await run(this.ctx, {
      key: PRACTICE_KEY,
      request: (idem) => api.deleteSession(id, { idempotencyKey: idem }),
      denyLabel: DENY,
      ok: () => ({ title: 'Practice chat deleted' }),
    })
    if (r.ok && this.current === id) this.current = null
    if (!r.ok && isNotBuilt(r.error)) this.error = problemText(r.error)
    this.ctx.changed()
  }

  // ---- the chat -----------------------------------------------------------------------------------------------------------

  setDraft(text: string): void {
    this.draft = text
    this.error = ''
    this.ctx.changed()
  }

  async send(): Promise<boolean> {
    const api = this.api
    const id = this.current
    const text = this.draft.trim()
    if (!api || !id || this.sending || !this.allowed()) return false
    if (!text) return false
    if (text.length > PRACTICE_TEXT_MAX) {
      this.error = `A text holds ${PRACTICE_TEXT_MAX} characters at most (now ${text.length}).`
      this.ctx.changed()
      return false
    }
    this.sending = true
    this.error = ''
    this.ctx.changed()
    const idem = newIdempotencyKey()
    const r = await run(this.ctx, {
      key: settingsKey(...sessionKey(id)),
      invalidate: [PRACTICE_KEY],
      idempotencyKey: idem,
      request: (k) => api.sendTurn(id, text, { idempotencyKey: k }),
      denyLabel: DENY,
    })
    this.sending = false
    if (r.ok) this.draft = ''
    else this.error = this.refusal(r.error)
    this.ctx.changed()
    return r.ok
  }

  private refusal(e: ApiError): string {
    if (e.code === 'PRACTICE_BUDGET') return 'Today’s practice budget is used up. Practice works again tomorrow.'
    if (e.code === 'PRACTICE_OFF') return 'Practice is off on the server for now.'
    if (e.code === 'PRACTICE_BUSY') return 'Oasis AI is still answering the last text. Wait a moment.'
    return e.status === 409 || e.status === 422 || e.status === 429 || isNotBuilt(e)
      ? problemText(e)
      : ''
  }

  async rerun(turnId: string): Promise<void> {
    const api = this.api
    const id = this.current
    if (!api || !id || this.sending || !this.allowed()) return
    this.sending = true
    this.ctx.changed()
    const r = await run(this.ctx, {
      key: settingsKey(...sessionKey(id)),
      request: (idem) => api.rerun(turnId, { idempotencyKey: idem }),
      denyLabel: DENY,
    })
    this.sending = false
    if (r.ok) this.corrected.delete(turnId)
    else this.error = this.refusal(r.error)
    this.ctx.changed()
  }

  correct(t: PracticeTurn): void {
    this.correction.open({
      clientText: t.clientText,
      wrongReply: t.replyText,
      source: 'practice',
      practiceTurnId: t.id,
      saved: () => {
        this.corrected.add(t.id)
        this.ctx.changed()
      },
    })
  }

  // ---- what the template reads (live.asst.pr) --------------------------------------------------------------------------------

  vals(visible: boolean): Vals {
    const st = this.state()
    const list = st === 'ready' ? this.list() : undefined
    const base: Vals = {
      locked: st === 'locked',
      lockedText: 'Ask an administrator to give your role the “Oasis AI assistant” permission to practise with Oasis AI.',
      loading: st === 'loading',
      failed: st === 'failed',
      soon: st === 'soon',
      soonText:
        'Coming soon: the practice chat is not built yet on the server. You will text Oasis AI as a client here, see what it would answer, and correct it.',
      retry: () => void this.ctx.qc.invalidateQueries({ queryKey: PRACTICE_KEY }),
      ready: !!list,
      explain: PRACTICE_EXPLAIN,
    }
    if (!list) {
      this.schedulePoll(undefined, false)
      return { ...base, banners: [], sessions: [], turns: [], hits: [] }
    }
    const tz = this.ctx.tz()
    const p = list.practice
    const blocked = practiceBlocked(p)
    const banners = practiceBanners(p).map((b) => ({ text: b.text, style: bannerStyle(b.tone) }))
    if (this.current && !list.sessions.some((s) => s.id === this.current)) {
      // deleted elsewhere, or older than 30 days: the session's own read decides (a fresh one is not listed yet)
      const st2 = this.ctx.status(sessionKey(this.current))
      if (st2 === 'error') this.current = null
    }
    const sessions = list.sessions.map((s) => ({
      label: personaLine(s),
      sub: turnsLabel(s.turns) + ' · ' + whenLabel(s.updatedAt, tz),
      style: listRowStyle(s.id === this.current),
      onClick: () => this.pick(s.id),
      confirming: this.confirming === s.id,
      askRemove: () => {
        if (!this.allowed()) return
        this.confirming = s.id
        this.ctx.changed()
      },
      remove: () => void this.remove(s.id),
      keep: () => {
        this.confirming = null
        this.ctx.changed()
      },
    }))
    const d = this.current ? this.detail(this.current) : undefined
    this.schedulePoll(d, visible)
    const running = !!d?.turns.some((t) => t.status === 'running')
    const originals = (d?.turns ?? []).filter((t) => !t.rerunOf).sort((a, b) => a.seq - b.seq)
    const reruns = (d?.turns ?? []).filter((t) => t.rerunOf)
    const turnVals = (t: PracticeTurn, isRerun: boolean): Vals => {
      const later = reruns.filter((x) => x.rerunOf === t.id)
      const answered = t.status !== 'running' && t.status !== 'failed'
      return {
        clientText: t.clientText,
        isRerun,
        rerunLabel: 'After your correction',
        hasReply: !!t.replyText,
        parts: replyParts(t.replyText ?? '').map((x) => ({
          text: x.text,
          style: x.link
            ? {
                display: 'inline-block',
                padding: '1px 7px',
                margin: '0 2px',
                borderRadius: '7px',
                background: 'rgba(255,255,255,.22)',
                border: '1px solid rgba(255,255,255,.45)',
                fontWeight: 800,
                fontSize: '12.5px',
              }
            : {},
        })),
        extras: t.extraTexts.map((x) => ({ text: x })),
        hasExtras: t.extraTexts.length > 0,
        extrasLabel: 'It would also text:',
        badges: t.badges.map((b) => ({ label: b.label, style: chipStyle(badgeTone(b.kind)) })),
        hasNote: !!turnNote(t),
        note: turnNote(t),
        noteStyle: {
          fontSize: '12.5px',
          fontWeight: 700,
          color: t.status === 'failed' ? '#C2410C' : 'var(--ink3)',
          lineHeight: 1.45,
        },
        running: t.status === 'running',
        canCorrect: answered && !isRerun,
        correct: () => this.correct(t),
        canRetry: this.corrected.has(t.id) && !running,
        tryAgain: () => void this.rerun(t.id),
        reruns: isRerun ? [] : later.map((x) => turnVals(x, true)),
      }
    }
    const hasSession = !!this.current
    const sessionState = !this.current
      ? 'none'
      : d
        ? 'ready'
        : this.ctx.status(sessionKey(this.current)) === 'error'
          ? isNotBuilt(this.ctx.error(sessionKey(this.current)))
            ? 'soon'
            : 'failed'
          : 'loading'
    const n = this.draft.trim().length
    const canSend = hasSession && !!d && !running && !this.sending && !blocked && n > 0
    const t = sw(this.verified)
    const sp = sw(this.spanish)
    return {
      ...base,
      banners,
      hasBanners: banners.length > 0,
      spent: 'Today: ' + usd(p.spentTodayUsd) + ' of ' + usd(p.budgetUsd),
      sessions,
      noSessions: sessions.length === 0,
      newSession: () => this.newSession(),
      picking: !hasSession,
      personaNew: seg(this.persona === 'new_texter'),
      personaClient: seg(this.persona === 'client'),
      pickNew: () => this.setPersona('new_texter'),
      pickClient: () => this.setPersona('client'),
      personaText:
        this.persona === 'new_texter'
          ? 'Someone the shop has never heard from. Oasis AI asks their name and car, as it would for real.'
          : 'A real client, read only: Oasis AI sees their visits, cars, balance and membership, and nothing is changed.',
      isClient: this.persona === 'client',
      clientQuery: this.clientQuery,
      setClientQuery: (e: InputEvent) => this.setClientQuery(e.target.value),
      clientStyle: inputStyle(false),
      hits: this.hits.map((h) => ({
        label: h.fullName + (h.phone ? ' · •••' + h.phone.replace(/\D/g, '').slice(-4) : ''),
        onClick: () => this.pickClient(h),
      })),
      hasHits: this.hits.length > 0,
      verifiedLabel: 'Verified this month',
      verifiedSub: 'On: Oasis AI treats them as a client who confirmed their number recently, so it can talk about their account.',
      verifiedTrack: t.track,
      verifiedKnob: t.knob,
      toggleVerified: () => {
        this.verified = !this.verified
        this.ctx.changed()
      },
      spanishLabel: 'The client writes in Spanish',
      spanishTrack: sp.track,
      spanishKnob: sp.knob,
      toggleSpanish: () => {
        this.spanish = !this.spanish
        this.ctx.changed()
      },
      start: () => void this.start(),
      startLabel: this.starting ? 'Starting…' : 'Start practice chat',
      startStyle: { ...primaryStyle(!blocked), opacity: this.starting ? 0.6 : 1 },
      hasSession,
      askRemoveCurrent: () => {
        if (!this.current || !this.allowed()) return
        this.confirming = this.current
        this.ctx.changed()
      },
      sessionLoading: sessionState === 'loading',
      sessionFailed: sessionState === 'failed',
      sessionSoon: sessionState === 'soon',
      sessionTitle: d ? personaLine(d.session) : '',
      sessionSub: d ? turnsLabel(d.session.turns) + ' · started ' + whenLabel(d.session.createdAt, tz) : '',
      turns: originals.map((x) => turnVals(x, false)),
      noTurns: !!d && originals.length === 0,
      emptyText: 'Text Oasis AI the way a client would, for example “Do you have a waiting room?”',
      draft: this.draft,
      setDraft: (e: InputEvent) => this.setDraft(e.target.value),
      draftKeys: (e: KeyEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault()
          void this.send()
        }
      },
      draftStyle: textareaStyle(n > PRACTICE_TEXT_MAX, 2),
      draftCount: n + ' / ' + PRACTICE_TEXT_MAX,
      draftCountStyle: countStyle(n > PRACTICE_TEXT_MAX),
      send: () => void this.send(),
      sendLabel: this.sending ? 'Sending…' : 'Send',
      sendStyle: primaryStyle(canSend),
      error: this.error,
      hasError: !!this.error,
      errorStyle: bannerStyle('red'),
      ghost: ghostStyle(),
      dangerGhost: ghostStyle(true),
    }
  }
}
