// The Payments design's own data, copied from design/extracted/payments/logic.original.js: the roles bundle, the price
// lists, the hand-written invoices of the first fortnight and the seeded pseudo-random history of the rest. Order of
// calls and every number is preserved (the generated invoices reuse ids of the hand-written ones, as in the design).
import {
  calcInvoice,
  type Invoice,
  type LedgerEvent,
  type LocalDay,
  type RangeKey,
  type RolesConfig,
  type Theme,
} from '@/lib/payments'
import { r2, todayStamp } from '@/lib'
import { serverNow } from '@/lib/clock'
import type { PaymentsData, PaymentsSeed } from './data'

export const DEF_ROLES: RolesConfig = {
  roles: [
    { id: 'super', name: 'Super Admin' },
    { id: 'mgmt', name: 'Management' },
    { id: 'acct', name: 'Accounting' },
    { id: 'support', name: 'Customer Support' },
    { id: 'crew', name: 'Crew' },
  ],
  perms: {
    super: { 'pay.reports': 1, 'pay.refund': 1, 'pay.adjust': 1, 'pay.credit': 1, 'pay.collect': 1 },
    mgmt: { 'pay.reports': 1, 'pay.refund': 1, 'pay.adjust': 1, 'pay.credit': 1, 'pay.collect': 1 },
    acct: { 'pay.reports': 1, 'pay.refund': 1, 'pay.adjust': 1, 'pay.credit': 1, 'pay.collect': 1 },
    support: { 'pay.refund': 1, 'pay.adjust': 1, 'pay.credit': 1, 'pay.collect': 1 },
    crew: {},
  },
  limits: {
    super: { refund: null, adjust: null, credit: null },
    mgmt: { refund: 1000, adjust: 500, credit: 500 },
    acct: { refund: 500, adjust: 250, credit: 250 },
    support: { refund: 50, adjust: 25, credit: 50 },
    crew: { refund: 25, adjust: 25, credit: 25 },
  },
}

export const PRICE: Record<string, number> = {
  'Express Hand Wash': 45,
  'Premium Hand Wash + Interior': 129,
  'Premium Hand Wash + Interior Refresh': 139,
  'Executive Detail': 260,
  'Executive Detail + Ceramic': 420,
  'Full Detail': 320,
  'Ceramic Maintenance + Wax': 180,
  'Exotic Detail Package': 650,
  'Family Wash + Pet Hair': 95,
}

export const ADD: Record<string, number> = {
  'Interior deep clean': 60,
  'Pet hair removal': 35,
  'Leather conditioning': 45,
  Wax: 40,
  'Clay bar': 50,
  'Odor removal': 30,
  'Engine bay cleaning': 55,
  'Ceramic maintenance': 120,
  'Rain repellent': 25,
  'Wheel deep clean': 40,
}

/** The design's frozen "today": Saturday, June 13, 2026 (month is 0-based). */
export const FROZEN_TODAY: LocalDay = { y: 2026, m: 5, d: 13 }

export const RANGE_LABELS: Record<RangeKey, string> = {
  today: 'Saturday, June 13',
  '7d': 'Jun 7 – Jun 13',
  '30d': 'May 15 – Jun 13',
  mtd: 'Jun 1 – Jun 13',
}

export const DEFAULT_ROLE = 'mgmt'
export const DEFAULT_SELECTED_ID = 'INV-20603'

interface Mk {
  id?: string
  off: number
  time: string
  client: string
  veh: string
  staff?: string
  svc: string
  add?: string[]
  tip?: number
  canceled?: boolean
  pre?: LedgerEvent[]
  adj?: Array<[number, string, string?]>
  pay?: 'full' | number
  method?: string
  creditUsed?: number
  post?: Array<Partial<LedgerEvent> & Pick<LedgerEvent, 'type' | 'amt'>>
}

/** The 105-invoice history of the design (hand-written invoices first, then 29 days of seeded random ones). */
export function buildInvoices(): Invoice[] {
  let seq = 20610
  const txs: Invoice[] = []
  const mk = (o: Mk): void => {
    const items = [
      { name: o.svc, price: PRICE[o.svc]! },
      ...(o.add || []).map((n) => ({ name: n, price: ADD[n]! })),
    ]
    const tx: Invoice = {
      id: o.id || 'INV-' + seq--,
      off: o.off,
      time: o.time,
      client: o.client,
      vehicle: o.veh,
      staff: o.staff || 'Marco R.',
      items,
      tip: o.tip || 0,
      canceled: !!o.canceled,
      events: [...(o.pre || [])],
    }
    ;(o.adj || []).forEach((a) =>
      tx.events.push({ type: 'adjust', amt: a[0], reason: a[1], by: a[2] || 'Rafael M.', t: o.time }),
    )
    const tot = calcInvoice(tx).total
    if (o.pay === 'full')
      tx.events.push({
        type: 'pay',
        amt: r2(tot - (o.creditUsed || 0)),
        method: o.method || 'Visa ••4421',
        by: 'System',
        t: o.time,
      })
    else if (o.pay! > 0)
      tx.events.push({
        type: 'pay',
        amt: o.pay as number,
        method: o.method || 'Visa ••4421',
        by: 'System',
        t: o.time,
        deposit: true,
      })
    ;(o.post || []).forEach((e) => tx.events.push({ t: o.time, by: 'Rafael M.', ...e }))
    txs.push(tx)
  }
  // today
  mk({
    id: 'INV-20608',
    off: 0,
    time: '10:05 AM',
    client: 'Aisha Rahman',
    veh: '2023 Range Rover Sport',
    svc: 'Executive Detail + Ceramic',
    add: ['Ceramic maintenance'],
    pay: 'full',
    method: 'Amex ••3008',
  })
  mk({
    id: 'INV-20607',
    off: 0,
    time: '10:15 AM',
    client: 'Marcus Webb',
    veh: '2017 Jeep Wrangler',
    staff: 'Unassigned',
    svc: 'Family Wash + Pet Hair',
    add: ['Odor removal'],
    pay: 20,
    method: 'Visa ••6610',
  })
  mk({
    id: 'INV-20606',
    off: 0,
    time: '9:50 AM',
    client: 'Liam Chen',
    veh: '2020 BMW M340i',
    svc: 'Ceramic Maintenance + Wax',
    pay: 'full',
    method: 'Visa ••7731',
  })
  mk({
    id: 'INV-20605',
    off: 0,
    time: '10:30 AM',
    client: 'Sofia Marchetti',
    veh: '2024 Porsche Macan',
    staff: 'Sofia D.',
    svc: 'Executive Detail',
    pay: 50,
    method: 'Visa ••0092',
  })
  mk({
    id: 'INV-20604',
    off: 0,
    time: '9:40 AM',
    client: 'Jonathan Franco',
    veh: '2023 Mercedes-Benz GLE',
    svc: 'Premium Hand Wash + Interior Refresh',
    add: ['Leather conditioning'],
    pay: 'full',
    method: 'Apple Pay',
  })
  mk({
    id: 'INV-20603',
    off: 0,
    time: '10:31 AM',
    client: 'Priya Nair',
    veh: '2022 Tesla Model Y',
    staff: 'Lena K.',
    svc: 'Premium Hand Wash + Interior',
    add: ['Rain repellent'],
    pay: 0,
  })
  mk({
    id: 'INV-20602',
    off: 0,
    time: '9:58 AM',
    client: 'David Okafor',
    veh: '2019 Ford F-150',
    svc: 'Full Detail',
    add: ['Engine bay cleaning'],
    tip: 20,
    adj: [[-25, 'Loyalty']],
    pay: 'full',
    method: 'Mastercard ••1180',
  })
  mk({
    id: 'INV-20601',
    off: 0,
    time: '8:52 AM',
    client: 'Maria Delgado',
    veh: '2021 Audi Q5',
    staff: 'Lena K.',
    svc: 'Express Hand Wash',
    add: ['Wax'],
    tip: 8,
    pay: 'full',
    method: 'Visa ••4421',
  })
  // specials
  mk({
    id: 'INV-20579',
    off: -1,
    time: '2:10 PM',
    client: 'Chloe Bennett',
    veh: '2022 BMW X5',
    staff: 'Lena K.',
    svc: 'Executive Detail',
    pay: 'full',
    method: 'Visa ••5521',
    post: [
      {
        type: 'refund',
        amt: 80,
        dest: 'card',
        method: 'Visa ••5521',
        reason: 'Service issue',
        note: 'Interior stain not fully removed',
        by: 'Sofia D.',
        byRole: 'Customer Support',
        status: 'pending',
        t: 'Yesterday 4:40 PM',
      },
    ],
  })
  mk({
    id: 'INV-20571',
    off: -2,
    time: '11:00 AM',
    client: 'Omar Haddad',
    veh: '2023 Porsche 911 Carrera',
    svc: 'Full Detail',
    canceled: true,
    pay: 50,
    method: 'Visa ••2290',
    post: [
      {
        type: 'refund',
        amt: 50,
        dest: 'card',
        method: 'Visa ••2290',
        reason: 'Customer canceled',
        by: 'Sofia D.',
        status: 'done',
        t: 'Jun 11 · 9:12 AM',
      },
    ],
  })
  mk({
    id: 'INV-20566',
    off: -3,
    time: '1:30 PM',
    client: 'Hannah Kim',
    veh: '2024 Rivian R1S',
    svc: 'Premium Hand Wash + Interior',
    add: ['Pet hair removal'],
    tip: 10,
    pay: 'full',
    post: [
      {
        type: 'refund',
        amt: 37.45,
        dest: 'card',
        method: 'Visa ••4421',
        reason: 'Add-on not performed',
        by: 'Rafael M.',
        status: 'done',
        t: 'Jun 10 · 3:05 PM',
      },
    ],
  })
  mk({
    id: 'INV-20560',
    off: -4,
    time: '10:20 AM',
    client: 'Victor Nguyen',
    veh: '2020 Honda Accord',
    svc: 'Express Hand Wash',
    creditUsed: 25,
    pre: [{ type: 'credit_apply', amt: 25, method: 'Store credit', by: 'Sofia D.', t: '10:20 AM' }],
    pay: 'full',
    method: 'Visa ••8812',
  })
  mk({
    id: 'INV-20552',
    off: -5,
    time: '3:15 PM',
    client: 'Mateo Silva',
    veh: '2022 Ford Bronco',
    svc: 'Premium Hand Wash + Interior',
    pay: 'full',
    method: 'Apple Pay',
    post: [
      {
        type: 'credit_issue',
        amt: 25,
        reason: 'Service recovery',
        note: 'Waited 40 min past slot',
        expiry: '90 days',
        t: 'Jun 8 · 4:02 PM',
      },
    ],
  })
  mk({
    id: 'INV-20548',
    off: -6,
    time: '9:00 AM',
    client: 'Zoe Laurent',
    veh: '2023 Audi e-tron GT',
    svc: 'Exotic Detail Package',
    adj: [[40, 'Extra soil surcharge']],
    pay: 'full',
    method: 'Amex ••1005',
  })
  mk({
    off: -14,
    time: '11:30 AM',
    client: 'Priya Nair',
    veh: '2022 Tesla Model Y',
    staff: 'Lena K.',
    svc: 'Express Hand Wash',
    pay: 'full',
    post: [
      {
        type: 'credit_issue',
        amt: 20,
        reason: 'Referral reward',
        expiry: 'No expiry',
        t: 'May 30 · 11:45 AM',
      },
    ],
  })
  mk({
    off: -20,
    time: '12:00 PM',
    client: 'Victor Nguyen',
    veh: '2020 Honda Accord',
    svc: 'Express Hand Wash',
    pay: 'full',
    post: [
      { type: 'credit_issue', amt: 25, reason: 'Weather closure', expiry: '90 days', t: 'May 24 · 12:10 PM' },
    ],
  })
  // generated history
  let t = 987654
  const rnd = (): number => {
    t += 0x6d2b79f5
    let r = Math.imul(t ^ (t >>> 15), 1 | t)
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r)
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296
  }
  const names = [
    'Olivia Hart',
    'Ethan Morales',
    'Isaac Patel',
    'Andre Thompson',
    'Camila Reyes',
    'Noah Fischer',
    'Leah Goldberg',
    'Ruby Castillo',
    'Ava Sinclair',
    'Diego Ramos',
    'Nina Petrova',
    'Caleb Owens',
    'Mia Torres',
    'Julian Brooks',
    'Grace Adeyemi',
    'Tom Bradley',
    'Nathan Brooks',
  ]
  const vehs = [
    '2022 BMW X5',
    '2021 Toyota 4Runner',
    '2020 Honda Accord',
    '2024 Rivian R1S',
    '2019 Mercedes-Benz C300',
    '2021 Kia Telluride',
    '2022 Tesla Model 3',
    '2024 Lexus GX 550',
    '2023 Genesis GV80',
    '2018 Lexus RX 350',
  ]
  const svcs = Object.keys(PRICE)
  const adds = Object.keys(ADD)
  const methods = ['Visa ••4421', 'Mastercard ••1180', 'Apple Pay', 'Apple Pay', 'Cash', 'Amex ••3008']
  for (let o = -1; o >= -29; o--) {
    if (o === -10) continue
    const n = 2 + Math.floor(rnd() * 3)
    for (let i = 0; i < n; i++) {
      const h = 8 + Math.floor(rnd() * 9)
      const r = rnd()
      mk({
        off: o,
        time: (h % 12 || 12) + ':' + (rnd() < 0.5 ? '00' : '30') + ' ' + (h >= 12 ? 'PM' : 'AM'),
        client: names[Math.floor(rnd() * names.length)]!,
        veh: vehs[Math.floor(rnd() * vehs.length)]!,
        staff: ['Marco R.', 'Lena K.', 'Sofia D.'][i % 3],
        svc: svcs[Math.floor(rnd() * svcs.length)]!,
        add: rnd() < 0.4 ? [adds[Math.floor(rnd() * adds.length)]!] : [],
        tip: 5 * Math.floor(rnd() * 4),
        adj: r < 0.08 ? [[-15, 'Loyalty']] : [],
        pay: 'full',
        method: methods[Math.floor(rnd() * methods.length)],
        post:
          r > 0.95
            ? [
                {
                  type: 'refund',
                  amt: 20,
                  dest: 'credit',
                  method: 'Store credit',
                  reason: 'Goodwill',
                  by: 'Sofia D.',
                  status: 'done',
                  t: '',
                },
              ]
            : [],
      })
    }
  }
  return txs
}

const ls = (k: string): unknown => {
  try {
    return JSON.parse(localStorage.getItem(k) || 'null')
  } catch {
    return null
  }
}

const THEME_KEY = 'oasis-theme'
const ROLES_KEY = 'oasis-roles'

/** The design as shipped: static invoices, roles from localStorage['oasis-roles'] (written by Settings), the device clock. */
export class FixtureData implements PaymentsData {
  readonly today = FROZEN_TODAY
  readonly rangeLabels = RANGE_LABELS

  seed(): PaymentsSeed {
    return {
      theme: (() => {
        try {
          return (localStorage.getItem(THEME_KEY) || 'light') as Theme
        } catch {
          return 'light'
        }
      })(),
      roles: (ls(ROLES_KEY) as RolesConfig | null) || DEF_ROLES,
      role: DEFAULT_ROLE,
      invoices: buildInvoices(),
      selectedId: DEFAULT_SELECTED_ID,
    }
  }

  stampNow(): string {
    const d = new Date(serverNow())
    return todayStamp(d.getHours(), d.getMinutes())
  }

  saveTheme(theme: Theme): void {
    try {
      localStorage.setItem(THEME_KEY, theme)
    } catch {
      // storage unavailable: the theme still applies for this page view
    }
  }
}
