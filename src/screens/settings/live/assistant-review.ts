// Settings → Oasis AI → Conversations (ADR 0174 §5; design §0 amendment and §9 tab 5; DEVIATIONS DV-713). A training
// review of real chats Oasis AI answered (90 days at most), behind "Oasis AI assistant" and "View client files": filters
// (days; all, handed to the team, fallback reply, the policy check stepped in, corrected), the list (first name and the
// last four digits only), one conversation's turns (the client's texts and the reply, both redacted by the server, what
// happened in plain words), and "This answer was wrong", which opens the correction dialog with source `live`. Staff still
// follow live chats in Messages; nothing here texts anyone. Until wave K2c the routes answer 501: "coming soon".
import type {
  AssistantReviewApi,
  ConversationDetail,
  ConversationList,
  ConversationSummary,
  ConversationTurn,
} from '@/data/ports/assistant-practice-api'
import {
  REVIEW_DAYS,
  REVIEW_FILTERS,
  clientLabel,
  flagWords,
  handoffWords,
  judgeWords,
  replyParts,
  statusWords,
  toolWords,
  turnsLabel,
  whenLabel,
} from '@/lib/settings/assistant-practice'
import type { ReviewFilter } from '@/lib/settings/assistant-practice'
import { chipStyle } from '@/lib/settings/assistant-knowledge'
import { chip, seg } from '@/lib/settings/styles'
import type { AiCtx, Vals } from './assistant-ctx'
import { COMING_SOON, ghostStyle, isNotBuilt, listRowStyle, settingsKey } from './assistant-ctx'
import type { CorrectionDialog } from './assistant-correction'

const PAGE = 30

export class ReviewSection {
  private days = 30
  private filter: ReviewFilter = 'all'
  private selected: string | null = null
  private more: ConversationSummary[] = []
  private cursor: string | null | undefined = undefined
  private loadingMore = false
  private error = ''

  constructor(
    private readonly ctx: AiCtx,
    private readonly api: AssistantReviewApi | undefined,
    private readonly correction: CorrectionDialog,
  ) {}

  private allowedRead(): boolean {
    return this.ctx.can('set.assistant') && this.ctx.can('cli.view')
  }

  private listKey(): readonly unknown[] {
    return ['assistant_conversations', this.days, this.filter]
  }

  list(): ConversationList | undefined {
    const api = this.api
    if (!api || !this.allowedRead()) return undefined
    const q = { days: this.days, filter: this.filter, limit: PAGE }
    return this.ctx.read(this.listKey(), () => api.conversations(q))
  }

  detail(id: string): ConversationDetail | undefined {
    const api = this.api
    if (!api) return undefined
    return this.ctx.read(['assistant_conversations', 'detail', id], () => api.conversation(id))
  }

  state(): 'locked' | 'loading' | 'failed' | 'soon' | 'ready' {
    if (!this.api || !this.allowedRead()) return 'locked'
    if (this.list()) return 'ready'
    const st = this.ctx.status(this.listKey())
    if (st !== 'error') return 'loading'
    return isNotBuilt(this.ctx.error(this.listKey())) ? 'soon' : 'failed'
  }

  setDays(d: number): void {
    this.days = d
    this.reset()
  }

  setFilter(f: ReviewFilter): void {
    this.filter = f
    this.reset()
  }

  private reset(): void {
    this.more = []
    this.cursor = undefined
    this.error = ''
    this.ctx.changed()
  }

  select(id: string): void {
    this.selected = id
    this.ctx.changed()
  }

  async loadMore(): Promise<void> {
    const api = this.api
    const first = this.list()
    const cursor = this.cursor === undefined ? first?.nextCursor : this.cursor
    if (!api || !cursor || this.loadingMore) return
    this.loadingMore = true
    this.ctx.changed()
    try {
      const r = await api.conversations({ days: this.days, filter: this.filter, limit: PAGE, cursor })
      this.more = [...this.more, ...r.conversations]
      this.cursor = r.nextCursor
    } catch (e) {
      this.error = isNotBuilt(e) ? COMING_SOON : 'The next page could not be read. Try again.'
    }
    this.loadingMore = false
    this.ctx.changed()
  }

  wrong(t: ConversationTurn): void {
    this.correction.open({
      clientText: t.clientTexts.join(' '),
      wrongReply: t.reply,
      source: 'live',
      assistantTurnId: t.id,
      saved: () => void this.ctx.qc.invalidateQueries({ queryKey: settingsKey('assistant_conversations') }),
    })
  }

  vals(): Vals {
    const st = this.state()
    const list = st === 'ready' ? this.list() : undefined
    const base: Vals = {
      locked: st === 'locked',
      lockedText:
        'Reviewing real chats needs both the “Oasis AI assistant” and the “View client files” permissions. Ask an administrator.',
      loading: st === 'loading',
      failed: st === 'failed',
      soon: st === 'soon',
      soonText:
        'Coming soon: the review of real chats is not built yet on the server. You will read what Oasis AI answered here, and correct a wrong answer.',
      retry: () => void this.ctx.qc.invalidateQueries({ queryKey: settingsKey('assistant_conversations') }),
      ready: !!list,
      explain:
        'Chats Oasis AI answered in the last days, for checking its answers. Live chats are followed in Messages; nothing here texts anyone.',
      days: REVIEW_DAYS.map((d) => ({ label: d + ' days', style: seg(this.days === d), onClick: () => this.setDays(d) })),
      filters: REVIEW_FILTERS.map((f) => ({
        label: f.label,
        style: chip(this.filter === f.key),
        onClick: () => this.setFilter(f.key),
      })),
    }
    if (!list) return { ...base, rows: [], turns: [] }
    const tz = this.ctx.tz()
    const all = [...list.conversations, ...this.more.filter((m) => !list.conversations.some((c) => c.id === m.id))]
    if (this.selected && !all.some((c) => c.id === this.selected)) this.selected = null
    const rows = all.map((c) => ({
      label: clientLabel(c.client),
      sub: whenLabel(c.lastTurnAt, tz) + ' · ' + turnsLabel(c.turns),
      flags: [
        ...(c.handoff ? [{ label: handoffWords(c.handoff), style: chipStyle(c.handoff.open ? 'amber' : 'neutral') }] : []),
        ...c.flags
          .filter((f) => f !== 'handed_off' || !c.handoff)
          .map((f) => ({ label: flagWords(f), style: chipStyle(f === 'corrected' ? 'green' : 'amber') })),
      ],
      style: listRowStyle(c.id === this.selected),
      onClick: () => this.select(c.id),
    }))
    const cursor = this.cursor === undefined ? list.nextCursor : this.cursor
    const d = this.selected ? this.detail(this.selected) : undefined
    const detailState = !this.selected
      ? 'none'
      : d
        ? 'ready'
        : this.ctx.status(['assistant_conversations', 'detail', this.selected]) === 'error'
          ? 'failed'
          : 'loading'
    const turns = (d?.turns ?? []).map((t) => {
      const facts = [
        statusWords(t.status),
        t.handoffReason ? 'Handed to the team (' + t.handoffReason.replace(/_/g, ' ') + ')' : '',
        judgeWords(t.judge),
        t.guard.length ? 'Rewritten: ' + t.guard.join(', ') : '',
        t.tools.length ? 'It ' + toolWords(t.tools) : '',
      ].filter(Boolean)
      return {
        when: whenLabel(t.startedAt, tz),
        clientTexts: t.clientTexts.map((x) => ({ text: x })),
        hasReply: !!t.reply,
        parts: replyParts(t.reply ?? '').map((x) => ({
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
        facts: facts.map((text) => ({ text })),
        hasFacts: facts.length > 0,
        corrected: !!t.correctionEntryId,
        correctedLabel: 'Corrected',
        correctedStyle: chipStyle('green'),
        canWrong: !!t.reply && !t.correctionEntryId,
        wrong: () => this.wrong(t),
      }
    })
    return {
      ...base,
      rows,
      noRows: rows.length === 0,
      emptyText:
        this.filter === 'all'
          ? `Oasis AI answered no chats in the last ${this.days} days.`
          : `No chats like that in the last ${this.days} days.`,
      hasMore: !!cursor,
      loadMore: () => void this.loadMore(),
      moreLabel: this.loadingMore ? 'Loading…' : 'Show more',
      error: this.error,
      hasError: !!this.error,
      picked: !!this.selected,
      noPick: !this.selected,
      pickText: 'Pick a chat on the left to read it.',
      detailLoading: detailState === 'loading',
      detailFailed: detailState === 'failed',
      title: d ? clientLabel(d.conversation.client) : '',
      sub: d ? turnsLabel(d.conversation.turns) + ' · last ' + whenLabel(d.conversation.lastTurnAt, tz) : '',
      turns,
      ghost: ghostStyle(),
    }
  }
}
