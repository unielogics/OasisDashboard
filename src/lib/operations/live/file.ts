// The appointment file (`sel`) of the live Operations screen: header, stage tracker, the eight tabs and the action bar,
// from the server's AppointmentFile plus the SMS thread and the membership view. Totals, balances, prices, checklist
// progress, credits and visit statistics are the server's; this file turns them into the template's strings and styles
// (the same literals as the fixture class's selVM) and wires the handlers. file.test.ts compares the style objects with
// the fixture class on equivalent data.
import type {
  AppointmentFile,
  FileChecklistSection,
  FilePhoto,
  MembershipView,
  OpsCard,
  PhotoCategory,
  Thread,
  ThreadMessage,
} from '@/data/ports/operations'
import { hexA, lighten } from '@/lib/color'
import { memberMeta } from '../status'
import type { Style } from '../types'
import { AMBER, LATE_COLOR, badgeStyle, memberBadge, payColor } from './board'
import { firstWord, initialsOf, opsMoney } from './fmt'

type VM = Record<string, unknown>

export type NextStepKey = OpsCard['next']['step']

/** The seven quick replies of the Messages tab (labels are the design's, keys the server's `qr_*` registry). */
export const QUICK_REPLIES: ReadonlyArray<readonly [key: string, label: string]> = [
  ['qr_confirmed', 'Confirmed'],
  ['qr_ready_for_you', 'We’re ready'],
  ['qr_checked_in', 'Checked in'],
  ['qr_being_cleaned', 'Being cleaned'],
  ['qr_ready_pickup', 'Ready for pickup'],
  ['qr_approve_addon', 'Approve add-on?'],
  ['qr_payment_link', 'Payment link'],
]

export const TAB_ICONS: Record<string, string> = {
  overview:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="3" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="3" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/><rect x="13" y="13" width="8" height="8" rx="1.5" stroke="currentColor" stroke-width="2"/></svg>',
  checklist:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 6l2 2 3-3M4 13l2 2 3-3M4 20l2 2 3-3M13 6h7M13 13h7M13 20h7" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  addons:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  photos:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="14" rx="2" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="13" r="3" stroke="currentColor" stroke-width="2"/><path d="M8 6l1.5-2h5L16 6" stroke="currentColor" stroke-width="2"/></svg>',
  messages:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M4 5h16v11H8l-4 4z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  payments:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" stroke-width="2"/><path d="M3 10h18" stroke="currentColor" stroke-width="2"/></svg>',
  membership:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M12 3l2.5 5 5.5.8-4 3.9.9 5.5L12 16.5 7.1 21l.9-5.5-4-3.9 5.5-.8z" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/></svg>',
  history:
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="none"><path d="M3 12a9 9 0 109-9 9 9 0 00-7 3.3M3 4v3h3" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M12 8v4l3 2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
}

const STAGES = ['booked', 'confirmed', 'arrived', 'cleaning', 'completed'] as const
const STAGE_LABELS: Record<string, string> = {
  booked: 'Booked',
  confirmed: 'Confirmed',
  arrived: 'Arrived',
  cleaning: 'In Wash',
  completed: 'Done',
}

/** The hint under the primary button for the step the server offers next. */
export function nextHint(step: NextStepKey, balanceCents: number): string {
  switch (step) {
    case 'confirm':
      return 'Customer hasn’t confirmed — send the reminder'
    case 'arrive':
      return 'Mark arrived once the customer pulls in'
    case 'start':
      return 'Drag the card onto an open bay, or start the wash here'
    case 'complete':
      return 'Wash finished — mark complete and move it to pickup'
    case 'collect':
      return 'Collect ' + opsMoney(balanceCents) + ' before release'
    default:
      return 'Job complete — closed and archived'
  }
}

/** "Today 10:00 AM · Premium Hand Wash": the day word comes from the business date. */
export function whenLabel(f: AppointmentFile, today: string, tomorrow: string): string {
  const d = f.overview.bizDate
  const word = d === today ? 'Today' : d === tomorrow ? 'Tomorrow' : f.overview.dateLabel
  return word + ' ' + f.overview.time + ' · ' + f.overview.service.name.split(' + ')[0]
}

// ---- checklist ------------------------------------------------------------------------------------------------------

export function checkVM(
  sections: readonly FileChecklistSection[],
  progress: { done: number; total: number; pct: number; allDone: boolean },
  dark: boolean,
  h: {
    toggleItem(id: string, done: boolean): void
    bulk(ids: string[], done: boolean, quiet: boolean): void
  },
): VM {
  const all = sections.flatMap((s) => s.items.map((i) => i.id))
  const allDone = progress.allDone
  return {
    checkDone: progress.done,
    checkTotal: progress.total,
    checkPct: progress.pct + '%',
    checkPctLabel: progress.pct + '%',
    checkAllLabel: allDone ? 'Clear all' : 'Check all',
    checkAllToggle: () => h.bulk(all, !allDone, false),
    checkAllStyle: {
      height: '46px',
      padding: '0 20px',
      borderRadius: '12px',
      fontWeight: 800,
      fontSize: '14px',
      flex: 'none',
      background: allDone ? 'var(--panel2)' : 'var(--accent)',
      color: allDone ? 'var(--ink2)' : '#fff',
      border: allDone ? '1px solid var(--line)' : '1px solid var(--accent)',
    },
    checkSections: sections.map((sc) => {
      const keys = sc.items.map((i) => i.id)
      const full = sc.items.length > 0 && sc.items.every((i) => i.done)
      const pk = sc.kind === 'package'
      return {
        title: sc.title,
        kind: pk ? 'Package' : 'Add-on',
        countLabel: sc.done + ' / ' + sc.total,
        kindStyle: {
          fontSize: '10.5px',
          fontWeight: 800,
          padding: '4px 8px',
          borderRadius: '6px',
          textTransform: 'uppercase',
          letterSpacing: '0.04em',
          flex: 'none',
          background: pk ? 'var(--accentSoft)' : hexA(AMBER, dark ? 0.22 : 0.14),
          color: pk ? 'var(--accentInk)' : dark ? lighten(AMBER) : '#8A5A06',
        },
        btnLabel: full ? 'Clear' : 'Check all',
        toggle: () => h.bulk(keys, !full, true),
        items: sc.items.map((it) => {
          const on = it.done
          return {
            label: it.label,
            done: on,
            toggle: () => h.toggleItem(it.id, !on),
            rowStyle: {
              display: 'flex',
              alignItems: 'center',
              gap: '13px',
              width: '100%',
              minHeight: '52px',
              textAlign: 'left',
              padding: '12px 15px',
              background: on ? 'var(--accentSoft)' : 'var(--panel)',
              border: '1px solid ' + (on ? 'var(--accentBrd)' : 'var(--line)'),
              borderRadius: '12px',
            },
            boxStyle: {
              width: '24px',
              height: '24px',
              borderRadius: '7px',
              flex: 'none',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: on ? 'var(--accent)' : 'transparent',
              border: on ? 'none' : '2px solid var(--ink3)',
            },
            labelStyle: {
              fontSize: '14px',
              fontWeight: 600,
              color: on ? 'var(--ink2)' : 'var(--ink)',
              textDecoration: on ? 'line-through' : 'none',
            },
          }
        }),
      }
    }),
  }
}

// ---- photos ---------------------------------------------------------------------------------------------------------

const tagStyle = (dark: boolean, c: string): Style => ({
  fontSize: '11px',
  fontWeight: 800,
  padding: '3px 9px',
  borderRadius: '7px',
  background: hexA(c, dark ? 0.2 : 0.13),
  color: dark ? lighten(c) : c,
  textTransform: 'uppercase',
  letterSpacing: '0.03em',
})

const slotBase: Style = {
  aspectRatio: '4/3',
  borderRadius: '11px',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
}

export interface PhotoHandlers {
  upload(category: PhotoCategory, file: File): void
  /** The browser-visible URL of a thumbnail (stable while the signature is fresh). */
  thumb(p: FilePhoto): string
}

export function photoSections(
  f: AppointmentFile,
  dark: boolean,
  canUpload: boolean,
  busy: ReadonlySet<string>,
  h: PhotoHandlers,
): VM[] {
  const defs: Array<[PhotoCategory, string, string, string, string]> = [
    ['arrival', 'Arrival', 'Captured', '#0E9E6E', 'photos'],
    ['before', 'Before', 'Captured', '#0E9E6E', 'photos'],
    ['after', 'After', 'Captured', '#0E9E6E', 'photos'],
    ['issue', 'Damage / Issues', 'Flagged', LATE_COLOR, 'notes'],
  ]
  return defs.map(([cat, title, tag, tagColor, noun]) => {
    const group = f.photos[cat]
    const n = group.count
    const items = group.items as FilePhoto[]
    const slots: VM[] = items.map((p) => ({
      icon: !p.thumbUrl && !p.url,
      thumb: p.thumbUrl || p.url ? h.thumb(p) : '',
      note: p.note ?? '',
      add: false,
      style: {
        ...slotBase,
        background: 'var(--panel3)',
        border: '1px solid var(--line)',
        overflow: 'hidden',
        position: 'relative',
      },
    }))
    slots.push({
      add: true,
      icon: false,
      thumb: '',
      note: '',
      busy: busy.has(cat),
      accept: 'image/jpeg,image/png,image/webp,image/heic,image/heif',
      disabled: !canUpload,
      onFile: (e: { target: { files?: FileList | null; value: string } }) => {
        const file = e.target.files?.[0]
        e.target.value = ''
        if (file) h.upload(cat, file)
      },
      style: {
        ...slotBase,
        background: 'var(--panel)',
        border: '1.5px dashed var(--line)',
        cursor: canUpload ? 'pointer' : 'not-allowed',
        position: 'relative',
        opacity: busy.has(cat) ? 0.5 : 1,
      },
    })
    const issue = cat === 'issue'
    return {
      title,
      count: n + ' ' + noun,
      tag: n ? tag : issue ? 'None' : 'Pending',
      tagStyle: tagStyle(dark, n ? tagColor : '#6B7280'),
      slots,
    }
  })
}

// ---- messages -------------------------------------------------------------------------------------------------------

/** The status text a bubble's time line carries (string table 4.4): queued and failed are shown, delivery states too. */
export function deliveryText(m: Pick<ThreadMessage, 'direction' | 'from' | 'status'>): string {
  if (m.direction !== 'out') return ''
  switch (m.status) {
    case 'queued':
      return ' · Queued'
    case 'sending':
      return ' · Sending'
    case 'sent':
      return ' · Sent'
    case 'delivered':
      return ' · Delivered'
    case 'failed':
      return ' · Failed'
    case 'expired':
      return ' · Expired'
    case 'canceled':
      return ' · Canceled'
    default:
      return ''
  }
}

const channelName = (c: string): string => (c === 'email' ? 'Email' : c === 'sms' ? 'SMS' : 'Internal')

export function messageVMs(items: readonly ThreadMessage[]): VM[] {
  return items.map((m) => {
    const out = m.from === 'staff' || m.from === 'system'
    return {
      text: m.text,
      time: m.time + deliveryText(m),
      channelTag: m.from === 'system' ? 'Automated · ' + channelName(m.channel) : null,
      rowStyle: { display: 'flex', justifyContent: out ? 'flex-end' : 'flex-start' },
      bubbleStyle: {
        maxWidth: '78%',
        padding: '11px 14px',
        borderRadius: out ? '15px 15px 4px 15px' : '15px 15px 15px 4px',
        background: m.from === 'system' ? 'var(--accentSoft)' : out ? 'var(--accent)' : 'var(--panel)',
        color: m.from === 'system' ? 'var(--accentInk)' : out ? '#fff' : 'var(--ink)',
        border: out && m.from !== 'system' ? 'none' : '1px solid var(--line)',
      },
      tagStyle: {
        fontSize: '10px',
        fontWeight: 800,
        textTransform: 'uppercase',
        letterSpacing: '0.04em',
        opacity: 0.7,
        marginBottom: '4px',
      },
      timeStyle: { fontSize: '10.5px', fontWeight: 600, marginTop: '5px', opacity: 0.65 },
    }
  })
}

/** What the header chip beside the phone number says about SMS (D1/D5). */
export function smsChip(c: AppointmentFile['customer']): { label: string; on: boolean } {
  if (c.smsOptedOut) return { label: 'SMS opted-out', on: false }
  if (c.smsOptedIn) return { label: 'SMS opted-in', on: true }
  return { label: 'SMS not opted in', on: false }
}

/** GSM-7 characters; the server normalises typographic quotes, dashes and ellipses to these before counting. */
const GSM7 =
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'
const GSM7_EXT = '^{}\\[~]|€'
const NORMALISE: Record<string, string> = {
  '’': "'",
  '‘': "'",
  '“': '"',
  '”': '"',
  '–': '-',
  '—': '-',
  '…': '...',
}

/** Characters and texts for a message as it will be sent (GSM-7: 160 / 153 per part, otherwise 70 / 67). */
export function smsSegments(text: string): { chars: number; parts: number; unicode: boolean } {
  const t = [...text].map((c) => NORMALISE[c] ?? c).join('')
  let units = 0
  let unicode = false
  for (const c of t) {
    if (GSM7.includes(c)) units += 1
    else if (GSM7_EXT.includes(c)) units += 2
    else {
      unicode = true
      units += c.length
    }
  }
  if (unicode) units = [...t].reduce((n, c) => n + c.length, 0)
  const single = unicode ? 70 : 160
  const multi = unicode ? 67 : 153
  return { chars: units, parts: units === 0 ? 0 : units <= single ? 1 : Math.ceil(units / multi), unicode }
}

// ---- the file -------------------------------------------------------------------------------------------------------

export interface FileUi {
  dark: boolean
  today: string
  tomorrow: string
  tab: string
  composer: string
  payTender: 'card' | 'cash'
  payLinkOpen: boolean
  payLinkUrl: string
  payLinkError: string
  can: { collect: boolean; message: boolean; checklist: boolean; member: boolean }
  busy: ReadonlySet<string>
  /** Business "now" used to say whether a message hold or a send is in flight. */
  sending: boolean
}

export interface FileHandlers extends PhotoHandlers {
  setTab(tab: string): void
  advance(): void
  toggleItem(id: string, done: boolean): void
  bulk(ids: string[], done: boolean, quiet: boolean): void
  toggleAddon(serviceId: string, name: string, on: boolean): void
  sendQuick(key: string, label: string): void
  setComposer(text: string): void
  sendComposer(): void
  markPaid(): void
  toggleLink(): void
  setLinkUrl(url: string): void
  sendLink(): void
  setTender(t: 'card' | 'cash'): void
  applyCredit(): void
  quickMsg(): void
}

const FALLBACK_TINT = '#8A6D3B'

export function fileVM(
  f: AppointmentFile,
  thread: Thread | undefined,
  mem: MembershipView | undefined,
  ui: FileUi,
  h: FileHandlers,
  renderIcon: (svg: string) => unknown,
): VM {
  const dark = ui.dark
  const m = f.membership
  const o = f.overview
  const inv = f.invoice
  const step = f.next.step
  const late = f.late
  const color = late ? LATE_COLOR : f.badge.color
  const pay = o.pay
  const messages = thread?.items ?? []
  const tint = m?.tint || FALLBACK_TINT
  const curIdx = STAGES.indexOf(f.status as (typeof STAGES)[number])
  const stages = STAGES.map((st, i) => {
    const done = i < curIdx
    const cur = i === curIdx
    return {
      label: STAGE_LABELS[st],
      mark: done ? '✓' : String(i + 1),
      dotStyle: {
        width: '30px',
        height: '30px',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontWeight: 800,
        fontSize: '12px',
        background: cur ? 'var(--accent)' : done ? 'var(--accentSoft)' : 'var(--panel3)',
        color: cur ? '#fff' : done ? 'var(--accentInk)' : 'var(--ink3)',
        border: cur ? '2px solid var(--accent)' : 'none',
      },
      labelStyle: {
        fontSize: '10.5px',
        fontWeight: 700,
        textAlign: 'center',
        color: cur || done ? 'var(--ink)' : 'var(--ink3)',
      },
      lineStyle: {
        width: '18px',
        height: '2px',
        background: i < STAGES.length - 1 ? (i < curIdx ? 'var(--accent)' : 'var(--line)') : 'transparent',
      },
    }
  })
  const ck = checkVM(f.checklist.sections, f.checklist, dark, h)
  const tabDefs: ReadonlyArray<readonly [string, string, string | number | null]> = [
    ['overview', 'Overview', null],
    ['checklist', 'Checklist', f.checklist.done + '/' + f.checklist.total],
    ['addons', 'Add-ons', f.addons.selected.length || null],
    ['photos', 'Photos', null],
    ['messages', 'Messages', messages.length || (thread ? 0 : null)],
    ['payments', 'Payments', null],
    ['membership', 'Membership', null],
    ['history', 'History', null],
  ]
  const tabs = tabDefs.map(([k, l, cnt]) => ({
    label: l,
    count: cnt,
    icon: renderIcon(TAB_ICONS[k]!),
    countStyle: {
      minWidth: '20px',
      height: '20px',
      padding: '0 6px',
      borderRadius: '7px',
      background: ui.tab === k ? 'var(--accent)' : 'var(--panel3)',
      color: ui.tab === k ? '#fff' : 'var(--ink3)',
      fontSize: '11px',
      fontWeight: 800,
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
    },
    style: {
      display: 'flex',
      alignItems: 'center',
      gap: '11px',
      height: '44px',
      padding: '0 14px',
      borderRadius: '12px',
      fontSize: '14px',
      fontWeight: 700,
      background: ui.tab === k ? 'var(--accentSoft)' : 'transparent',
      color: ui.tab === k ? 'var(--accentInk)' : 'var(--ink2)',
    },
    onClick: () => h.setTab(k),
  }))

  // ---- payments tab
  const awaiting = inv?.awaitingCents ?? 0
  const pending = pay.kind === 'pending'
  const paid = pay.kind === 'paid'
  const settled = paid || pending
  const lineRow = (label: string, val: string, kind: 'item' | 'addon' | 'total' | 'paid') => ({
    label,
    val,
    kind,
  })
  const taxLabel = 'Tax (' + (inv?.taxBp ? trimRate(inv.taxBp) : '7') + '%)'
  const rows = inv
    ? [
        ...inv.items.map((it) =>
          lineRow(
            it.kind === 'addon' ? '+ ' + it.name : it.name,
            opsMoney(it.priceCents),
            it.kind === 'addon' ? 'addon' : 'item',
          ),
        ),
        ...(inv.tipCents ? [lineRow('Tip', opsMoney(inv.tipCents), 'item')] : []),
        lineRow(taxLabel, opsMoney(inv.taxCents), 'item'),
        lineRow('Total', opsMoney(inv.totalCents), 'total'),
        ...(inv.depositCents > 0 && inv.balanceCents > 0
          ? [lineRow('Deposit paid', '– ' + opsMoney(inv.depositCents), 'paid')]
          : []),
      ]
    : [lineRow(o.service.name, opsMoney(o.service.priceCents), 'item')]
  const payRows = rows.map((r) => ({
    label: r.label,
    val: r.val,
    style: {
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: r.kind === 'total' ? '14px 0 6px' : '8px 0',
      borderTop: r.kind === 'total' ? '1px solid var(--line)' : 'none',
      marginTop: r.kind === 'total' ? '6px' : '0',
    },
    labelStyle: {
      fontSize: r.kind === 'total' ? '15px' : '13.5px',
      fontWeight: r.kind === 'total' ? 800 : 600,
      color: r.kind === 'addon' ? 'var(--accentInk)' : r.kind === 'paid' ? '#0E9E6E' : 'var(--ink2)',
    },
    valStyle: {
      fontSize: r.kind === 'total' ? '18px' : '14px',
      fontWeight: r.kind === 'total' ? 800 : 700,
      color: r.kind === 'paid' ? '#0E9E6E' : 'var(--ink)',
      fontFamily: r.kind === 'total' ? "'Bricolage Grotesque',sans-serif" : 'inherit',
    },
  }))
  const payBig = inv ? opsMoney(settled ? inv.totalCents : pay.balanceCents) : '$0'
  const methodLabel = inv?.payMethodLabel ?? null
  const canCollect = ui.can.collect

  // ---- membership / history
  const hist = mem?.history
  const upgrade = mem?.upgrade ?? null
  const sms = smsChip(f.customer)

  const tab = ui.tab
  const total = ck.checkTotal as number
  void total
  return {
    id: f.id,
    name: f.customer.name,
    initials: f.customer.initials || initialsOf(f.customer.name),
    vehicle: [f.vehicle?.year, f.vehicle?.make, f.vehicle?.model].filter(Boolean).join(' '),
    vehicleLine:
      [f.vehicle?.year, f.vehicle?.make, f.vehicle?.model].filter(Boolean).join(' ') +
      (f.vehicle?.color ? ' · ' + f.vehicle.color : ''),
    color: f.vehicle?.color ?? '',
    plate: f.vehicle?.plate ?? '',
    phone: f.customer.phone ?? '—',
    when: whenLabel(f, ui.today, ui.tomorrow),
    time: o.time,
    service: o.service.name,
    durLabel: o.durationMin + ' min',
    bayLabel: o.bayLabel === 'No bay' ? 'Unassigned' : o.bayLabel,
    worker: o.staff.name,
    badgeLabel: f.badge.label,
    badgeStyle: badgeStyle(color, dark),
    member: !!m,
    noMember: !m,
    memberLabel: m ? firstWord(m.plan) : '',
    memberPlain: m ? m.plan : 'Non-member',
    memberStyle: memberBadge(m?.plan ?? null, dark, 'file'),
    vip: f.customer.vip,
    notes:
      o.notes || o.specialInstructions
        ? (o.notes ?? 'No special instructions on file.')
        : 'No special instructions on file.',
    special: o.specialInstructions || null,
    payLabel: paid ? 'Paid in full' : pay.label,
    payColor: payColor(pay.kind, dark),
    stages,
    tabs,
    tabOverview: tab === 'overview',
    tabChecklist: tab === 'checklist',
    tabAddons: tab === 'addons',
    tabPhotos: tab === 'photos',
    tabMessages: tab === 'messages',
    tabPayments: tab === 'payments',
    tabMembership: tab === 'membership',
    tabHistory: tab === 'history',
    ...ck,
    // add-ons
    addonTotal: opsMoney(f.addons.totalCents),
    addonCatalog: f.addons.catalog.map((a) => ({
      name: a.name,
      price: opsMoney(a.priceCents),
      on: a.selected,
      toggle: () => h.toggleAddon(a.serviceId, a.name, !a.selected),
      rowStyle: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '13px 15px',
        background: a.selected ? 'var(--accentSoft)' : 'var(--panel)',
        border: '1px solid ' + (a.selected ? 'var(--accentBrd)' : 'var(--line)'),
        borderRadius: '12px',
      },
      boxStyle: {
        width: '22px',
        height: '22px',
        borderRadius: '7px',
        flex: 'none',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: a.selected ? 'var(--accent)' : 'transparent',
        border: a.selected ? 'none' : '2px solid var(--ink3)',
      },
    })),
    photoSections: photoSections(f, dark, ui.can.checklist, ui.busy, h),
    // messages
    messages: messageVMs(messages),
    templates: QUICK_REPLIES.map(([key, label]) => ({
      label,
      send: () => h.sendQuick(key, label),
      style: pillStyle(!ui.can.message),
    })),
    composer: ui.composer,
    setComposer: (e: { target: { value: string } }) => h.setComposer(e.target.value),
    sendMessage: () => h.sendComposer(),
    composerKeys: (e: { key: string; shiftKey: boolean; preventDefault(): void }) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        h.sendComposer()
      }
    },
    composerPlaceholder: composerPlaceholder(thread, ui.can.message),
    composerDisabled: !ui.can.message,
    composerHint: composerHint(ui.composer),
    composerHasHint: ui.composer.trim().length > 0,
    composerSendStyle: {
      width: '48px',
      height: '48px',
      background: 'var(--accent)',
      borderRadius: '13px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      opacity: ui.can.message && !ui.sending ? 1 : 0.5,
      cursor: ui.can.message ? 'pointer' : 'not-allowed',
    },
    smsChipLabel: sms.label,
    smsChipStyle: {
      display: 'inline-flex',
      alignItems: 'center',
      gap: '5px',
      fontSize: '12px',
      fontWeight: 700,
      color: sms.on ? '#1FA855' : 'var(--ink3)',
    },
    smsDotStyle: {
      width: '7px',
      height: '7px',
      borderRadius: '50%',
      background: sms.on ? '#25D366' : 'var(--ink3)',
    },
    // payments
    payRows,
    payStatusLabel: paid
      ? 'Paid in full'
      : pending
        ? 'Payment pending'
        : pay.kind === 'deposit'
          ? 'Balance due'
          : 'Awaiting payment',
    payBig,
    payMethod: settled
      ? pending
        ? (methodLabel ?? 'Card') + ' · awaiting Squarespace'
        : (methodLabel ?? 'Paid')
      : 'No payment on file',
    payCardStyle: {
      padding: '20px',
      borderRadius: '16px',
      background: paid ? 'var(--accentSoft)' : pending ? hexA(AMBER, dark ? 0.2 : 0.14) : 'var(--ink)',
      color: paid ? 'var(--accentInk)' : pending ? (dark ? lighten(AMBER) : '#8A5A06') : 'var(--bg)',
    },
    showCollect: !!inv && !settled && pay.kind !== 'none',
    isPaid: paid,
    isPending: pending,
    pendingBoxStyle: {
      display: 'flex',
      alignItems: 'center',
      gap: '10px',
      padding: '16px',
      background: hexA(AMBER, dark ? 0.2 : 0.14),
      borderRadius: '13px',
      color: dark ? lighten(AMBER) : '#8A5A06',
    },
    pendingIconStyle: {
      width: '36px',
      height: '36px',
      borderRadius: '50%',
      background: hexA(AMBER, dark ? 0.3 : 0.2),
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      flex: 'none',
    },
    pendingTitleStyle: { fontWeight: 800, fontSize: '14px' },
    pendingLine:
      awaiting > 0 ? opsMoney(awaiting) + ' recorded by staff · waiting for Squarespace to confirm' : '',
    collect: () => h.markPaid(),
    sendLink: () => h.toggleLink(),
    payTenders: (['card', 'cash'] as const).map((t) => ({
      label: t === 'card' ? 'Card' : 'Cash',
      onClick: () => h.setTender(t),
      style: tenderStyle(ui.payTender === t, !canCollect),
    })),
    collectLabel: 'Mark Paid · ' + payBig,
    collectStyle: collectStyle(!canCollect),
    linkStyle: linkButtonStyle(!canCollect),
    collectTitle: canCollect ? '' : 'Role can’t collect payments',
    payLinkOpen: ui.payLinkOpen,
    payLinkUrl: ui.payLinkUrl,
    setLinkUrl: (e: { target: { value: string } }) => h.setLinkUrl(e.target.value),
    submitLink: () => h.sendLink(),
    payLinkError: ui.payLinkError,
    hasPayLinkError: !!ui.payLinkError,
    // membership
    memberCardStyle: {
      padding: '24px',
      borderRadius: '18px',
      background: `linear-gradient(135deg, ${tint}, ${hexA(tint, 0.78)})`,
      color: '#fff',
      boxShadow: '0 12px 30px ' + hexA(tint, 0.35),
    },
    renewDate: m?.renewLabel ?? '—',
    creditsLeft: m ? (m.creditsLeft === null ? '∞' : String(m.creditsLeft)) : '0',
    creditsUsed: String(m?.creditsUsed ?? 0),
    memberMonths: String(m?.memberMonths ?? 0),
    perks: m?.perks ?? [],
    riskStyle: riskStyle(m?.retention?.tone ?? 'green'),
    riskLabel: m?.retention?.label ?? '',
    riskDesc: m?.retention?.desc ?? '',
    creditAvailable: !!m?.creditAvailable,
    applyCredit: () => h.applyCredit(),
    applyCreditStyle: {
      height: '50px',
      padding: '0 22px',
      background: 'var(--panel)',
      color: 'var(--accentInk)',
      border: '1px solid var(--accentBrd)',
      borderRadius: '13px',
      fontWeight: 700,
      fontSize: '14px',
      marginRight: '10px',
    },
    upgradeText:
      upgrade?.candidate && upgrade.copy
        ? upgrade.copy
        : `${f.customer.name} is not a member yet. Offer a plan at check-out.`,
    // history
    history: historyRows(f, mem),
    visitCount: String(hist?.visitCount ?? f.history.visitCount),
    lifetimeSpend: opsMoney(hist?.lifetimeSpendCents ?? 0),
    avgFreq: hist?.avgFreqDays ? Math.round(hist.avgFreqDays) + ' days' : '—',
    // actions
    nextLabel: f.next.step ? f.next.label : '',
    hasNext: !!step,
    done: !step,
    nextHint: nextHint(step, pay.balanceCents),
    doNext: () => h.advance(),
    quickMsg: () => h.quickMsg(),
    // the pickup chip state, for the action bar
    pickup: f.overview.pickupState,
  }
}

const trimRate = (bp: number): string => String(+(bp / 100).toFixed(2))

function pillStyle(disabled: boolean): Style {
  return {
    flex: 'none',
    padding: '8px 13px',
    background: 'var(--panel2)',
    border: '1px solid var(--line)',
    borderRadius: '20px',
    fontSize: '12.5px',
    fontWeight: 700,
    color: 'var(--ink2)',
    whiteSpace: 'nowrap',
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

function tenderStyle(on: boolean, disabled: boolean): Style {
  return {
    flex: 1,
    height: '44px',
    borderRadius: '11px',
    fontWeight: 700,
    fontSize: '13.5px',
    background: on ? 'var(--accent)' : 'var(--panel)',
    color: on ? '#fff' : 'var(--ink)',
    border: '1px solid ' + (on ? 'var(--accent)' : 'var(--line)'),
    opacity: disabled ? 0.5 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer',
  }
}

const collectStyle = (disabled: boolean): Style => ({
  height: '56px',
  background: 'var(--accent)',
  color: '#fff',
  borderRadius: '13px',
  fontWeight: 800,
  fontSize: '15.5px',
  boxShadow: '0 8px 20px var(--accentSoft)',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
})

const linkButtonStyle = (disabled: boolean): Style => ({
  height: '52px',
  background: 'var(--panel)',
  border: '1px solid var(--line)',
  borderRadius: '13px',
  fontWeight: 700,
  fontSize: '14px',
  color: 'var(--ink)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  gap: '8px',
  opacity: disabled ? 0.5 : 1,
  cursor: disabled ? 'not-allowed' : 'pointer',
})

function riskStyle(tone: 'green' | 'red'): Style {
  const ok = tone === 'green'
  return {
    padding: '16px',
    borderRadius: '14px',
    background: ok ? 'var(--accentSoft)' : '#FBEAE0',
    color: ok ? 'var(--accentInk)' : LATE_COLOR,
  }
}

function composerPlaceholder(thread: Thread | undefined, canMessage: boolean): string {
  if (!canMessage) return 'Your role can’t send messages'
  const c = thread?.customer
  if (c?.optedOut) return 'Customer opted out of SMS — sending is blocked'
  if (c && !c.hasPhone) return 'No phone number on file'
  if (c && !c.smsOptedIn) return 'Customer has not opted in to SMS'
  return 'Type a message…'
}

function composerHint(text: string): string {
  const s = smsSegments(text)
  if (!s.chars) return ''
  return `${s.chars} characters · ${s.parts} text${s.parts === 1 ? '' : 's'}${s.unicode ? ' · special characters' : ''}`
}

const MONTH_ABBR = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC']

/** Past visits first (date block, package, amount, the favourite star), then the activity log lines. */
function historyRows(f: AppointmentFile, mem: MembershipView | undefined): VM[] {
  const fav = mem?.history.favPackage ?? null
  const visits = f.history.recent
    .filter((v) => v.id !== f.id)
    .map((v, i) => {
      const [, mo, da] = v.bizDate.split('-')
      return {
        day: da ?? '',
        mon: MONTH_ABBR[Number(mo) - 1] ?? '',
        service: v.service,
        note: '',
        amount: opsMoney(v.priceCents),
        fav:
          !!fav &&
          v.service === fav &&
          i === f.history.recent.filter((x) => x.id !== f.id).findIndex((x) => x.service === fav),
      }
    })
  const log = f.activity
    .slice()
    .reverse()
    .map((a) => {
      const [dayWord, clock] = splitAt(a.atLabel)
      const [hhmm, ap] = clock.split(' ')
      return {
        day: hhmm ?? '',
        mon: ap ?? '',
        service: a.text,
        note: [dayWord, a.actorName ?? channelsLabel(a.channels)].filter(Boolean).join(' · '),
        amount: '',
        fav: false,
      }
    })
  return [...visits, ...log]
}

const channelsLabel = (c: readonly string[]): string => c.map(channelName).join(' + ')

/** "Yesterday 4:02 PM" -> ["Yesterday", "4:02 PM"]; "Jun 11 · 9:12 AM" -> ["Jun 11", "9:12 AM"]. */
function splitAt(label: string): [string, string] {
  const m = /^(.*?)(?: · | )(\d{1,2}:\d{2} [AP]M)$/.exec(label)
  return m ? [m[1]!, m[2]!] : ['', label]
}

export { memberMeta }
