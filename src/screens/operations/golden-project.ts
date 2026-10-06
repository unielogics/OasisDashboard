/* eslint-disable @typescript-eslint/no-explicit-any */
// What the golden file records from the ORIGINAL Command Center and what the port is compared against: the data-bearing
// parts of renderVals() (counts, labels, totals, ids, order), not the style objects (the parity harness diffs those
// pixel for pixel). Shared by tests/operations/extract-golden.ts (runs the original bundle in Chromium) and golden.test.ts.

type Vals = Record<string, any>

export const BASELINE = {
  view: 'timeline',
  search: '',
  range: 'next24',
  selectedId: null,
  modalTab: 'overview',
  calMode: 'day',
  calOffset: 0,
  theme: 'light',
  newOpen: false,
  dragId: null,
  dropTarget: null,
}

export type Section =
  | 'header'
  | 'kpis'
  | 'alerts'
  | 'groups'
  | 'bays'
  | 'arrivals'
  | 'completedJobs'
  | 'queue'
  | 'staffCols'
  | 'newServices'
  | 'newSlots'
  | 'calendar'
  | 'sel'

export interface GoldenScenario {
  name: string
  patch: Record<string, unknown>
  /** The projection keeps only these sections (all when omitted). */
  sections?: Section[]
}

const BOARD: Section[] = [
  'header',
  'kpis',
  'groups',
  'bays',
  'arrivals',
  'completedJobs',
  'queue',
  'staffCols',
  'alerts',
]

const ids = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'a9', 'a10', 'a11', 'a12']

export const GOLDEN_SCENARIOS: GoldenScenario[] = [
  { name: 'initial light', patch: {} },
  { name: 'initial dark', patch: { theme: 'dark' } },
  { name: 'bay board', patch: { view: 'bay' }, sections: BOARD },
  { name: 'staff', patch: { view: 'staff' }, sections: BOARD },
  { name: 'range today', patch: { range: 'today' }, sections: BOARD },
  { name: 'range tomorrow', patch: { range: 'tomorrow' }, sections: BOARD },
  { name: 'range week', patch: { range: 'week' }, sections: BOARD },
  { name: 'search marcus', patch: { search: 'marcus' }, sections: BOARD },
  { name: 'search bmw bay', patch: { search: 'bmw', view: 'bay' }, sections: BOARD },
  { name: 'search nothing', patch: { search: 'zzz' }, sections: BOARD },
  { name: 'new appointment', patch: { newOpen: true }, sections: ['header', 'newServices', 'newSlots'] },
  ...[-19, -10, -3, -1, 0, 1, 2, 5, 7, 14, 21, 25, 86, 200, 380].map((o) => ({
    name: `calendar day ${o}`,
    patch: { view: 'calendar', calMode: 'day', calOffset: o },
    sections: ['header', 'calendar'] as Section[],
  })),
  ...[-19, -10, 0, 1, 21, 86, 200, 380].map((o) => ({
    name: `calendar week ${o}`,
    patch: { view: 'calendar', calMode: 'week', calOffset: o },
    sections: ['header', 'calendar'] as Section[],
  })),
  ...[-19, 0, 21, 86, 200, 400].map((o) => ({
    name: `calendar month ${o}`,
    patch: { view: 'calendar', calMode: 'month', calOffset: o },
    sections: ['header', 'calendar'] as Section[],
  })),
  ...ids.map((id) => ({
    name: `file ${id}`,
    patch: { selectedId: id, modalTab: 'payments' },
    sections: ['header', 'sel'] as Section[],
  })),
]

const pickKeys = (o: any, keys: string[]) => Object.fromEntries(keys.map((k) => [k, o?.[k]]))

const card = (c: any) =>
  pickKeys(c, [
    'id',
    'name',
    'vehicleLine',
    'short',
    'service',
    'time',
    'statusColor',
    'badgeLabel',
    'vip',
    'member',
    'memberLabel',
    'bayLabel',
    'durLabel',
    'payLabel',
    'hasNotes',
    'hasPhotos',
    'hasAddons',
    'addonCount',
    'nextLabel',
  ])

/** The projection of one renderVals() result (already passed through serializeVals). */
export function project(v: Vals, sections?: Section[]): unknown {
  const all = projectAll(v)
  if (!sections) return all
  return Object.fromEntries(sections.map((k) => [k, (all as any)[k]]))
}

function projectAll(v: Vals): unknown {
  const sel = v.sel
  return {
    header: pickKeys(v, [
      'theme',
      'view',
      'showRange',
      'emergencyOn',
      'emergencyText',
      'clockLabel',
      'dateLabel',
      'inFacilityLabel',
      'apptCount',
      'completedCount',
      'noCompleted',
      'alertCount',
      'newOpen',
      'newTitle',
      'modalOpen',
      'dragging',
    ]),
    kpis: v.kpis,
    alerts: v.alerts.map((a: any) => pickKeys(a, ['glyph', 'title', 'desc', 'actionLabel', 'pri'])),
    groups: v.groups.map((g: any) => ({
      ...pickKeys(g, ['key', 'day', 'time', 'ampm', 'dividerLabel']),
      divider: g.dividerStyle?.display !== 'none',
      items: g.items.map(card),
    })),
    bays: v.bays.map((b: any) =>
      pickKeys(b, [
        'name',
        'free',
        'occupied',
        'nextUp',
        'badgeLabel',
        'vehicle',
        'customer',
        'plate',
        'service',
        'worker',
        'workerInitials',
        'showProgress',
        'elapsed',
        'eta',
        'progressLabel',
        'durLabel',
        'nextLabel',
        'drop',
      ]),
    ),
    arrivals: v.arrivals.map((a: any) => pickKeys(a, ['title', 'desc', 'prepLabel'])),
    completedJobs: v.completedJobs.map((c: any) =>
      pickKeys(c, [
        'id',
        'name',
        'vehicleLine',
        'service',
        'time',
        'accent',
        'payChipLabel',
        'pickupChipLabel',
      ]),
    ),
    queue: v.queue.map(card),
    staffCols: v.staffCols.map((s: any) => ({
      ...pickKeys(s, ['name', 'role', 'initials', 'count', 'empty']),
      jobs: s.jobs.map(card),
    })),
    newServices: v.newServices.map((s: any) => pickKeys(s, ['name', 'dur', 'price'])),
    newSlots: v.newSlots.map((s: any) => s.label),
    calendar: {
      ...pickKeys(v, [
        'calLabel',
        'calSub',
        'calClosed',
        'calClosedReason',
        'calHint',
        'calIsDay',
        'calIsWeek',
        'calIsMonth',
      ]),
      calDow: v.calDow,
      calRows: v.calRows.map((r: any) => ({
        ...pickKeys(r, ['time', 'ampm', 'empty', 'drop']),
        items: r.items.map(card),
      })),
      calWeek: v.calWeek.map((c: any) =>
        pickKeys(c, ['dow', 'num', 'count', 'countLabel', 'open', 'closed', 'reason', 'isToday']),
      ),
      calMonth: v.calMonth.map((c: any) =>
        pickKeys(c, ['num', 'showCount', 'countLabel', 'closed', 'reason']),
      ),
    },
    sel: sel
      ? {
          ...pickKeys(sel, [
            'id',
            'name',
            'initials',
            'vehicle',
            'vehicleLine',
            'plate',
            'phone',
            'when',
            'time',
            'service',
            'durLabel',
            'bayLabel',
            'worker',
            'badgeLabel',
            'member',
            'memberLabel',
            'memberPlain',
            'vip',
            'notes',
            'special',
            'payLabel',
            'payColor',
            'payStatusLabel',
            'payBig',
            'payMethod',
            'showCollect',
            'isPaid',
            'checkDone',
            'checkTotal',
            'checkPct',
            'checkAllLabel',
            'addonTotal',
            'renewDate',
            'creditsLeft',
            'creditsUsed',
            'memberMonths',
            'perks',
            'riskLabel',
            'riskDesc',
            'visitCount',
            'lifetimeSpend',
            'avgFreq',
            'nextLabel',
            'hasNext',
            'done',
            'nextHint',
            'history',
          ]),
          stages: sel.stages.map((s: any) => pickKeys(s, ['label', 'mark'])),
          tabs: sel.tabs.map((t: any) => pickKeys(t, ['label', 'count'])),
          payRows: sel.payRows.map((r: any) => pickKeys(r, ['label', 'val'])),
          checkSections: sel.checkSections.map((s: any) => ({
            ...pickKeys(s, ['title', 'kind', 'countLabel', 'btnLabel']),
            items: s.items.map((i: any) => pickKeys(i, ['label', 'done'])),
          })),
          addonCatalog: sel.addonCatalog.map((a: any) => pickKeys(a, ['name', 'price', 'on'])),
          photoSections: sel.photoSections.map((p: any) => ({
            ...pickKeys(p, ['title', 'count', 'tag']),
            slots: p.slots.map((s: any) => (s.icon ? 'photo' : 'add')),
          })),
          messages: sel.messages.map((m: any) => pickKeys(m, ['text', 'time', 'channelTag'])),
          templates: sel.templates.map((t: any) => t.label),
        }
      : null,
  }
}
