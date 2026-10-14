// Fixtures of Settings → Shop floor (ADR 0180 and its 2026-10-14 amendment): GET /kiosk and GET /reports/employee-activity
// as the backend answers them (api-spec 31.3, 31.4). Shared by the view-model and render tests. Not shipped.
import type { EmployeeActivity, KioskOverview } from '@/data/ports/kiosk-api'

export function overviewFixture(over: Partial<KioskOverview> = {}): KioskOverview {
  return {
    enabled: true,
    version: 3,
    yourAddress: '73.12.4.9',
    yourAddressIsShop: false,
    canManageNetworks: true,
    networks: [
      {
        id: 'net-1',
        address: '73.12.4.80',
        label: 'Shop Wi-Fi',
        addedAt: '2026-10-01T14:00:00Z',
        addedBy: 'Amara O.',
        lastSeenAt: '2026-10-13T12:00:00Z',
        failedAttempts: 0,
        lockedOut: false,
      },
      {
        id: 'net-2',
        address: '2001:db8:1:2::/64',
        label: null,
        addedAt: '2026-10-02T14:00:00Z',
        addedBy: null,
        lastSeenAt: null,
        failedAttempts: 30,
        lockedOut: true,
      },
    ],
    refused: [
      {
        id: 'ref-1',
        address: '98.4.2.1',
        attempts: 2,
        browserName: 'Front desk tablet',
        firstSeenAt: '2026-10-13T12:00:00Z',
        lastSeenAt: '2026-10-13T12:05:00Z',
        fromKnownBrowser: true,
      },
      {
        id: 'ref-2',
        address: '203.0.113.50',
        attempts: 1,
        browserName: null,
        firstSeenAt: '2026-10-13T13:00:00Z',
        lastSeenAt: '2026-10-13T13:00:00Z',
        fromKnownBrowser: false,
      },
    ],
    thisDeviceId: null,
    devices: [
      {
        id: 'dev-1',
        name: 'Front desk tablet',
        state: 'unlocked',
        locksAt: '2026-10-14T01:00:00Z',
        lastSeenAt: '2026-10-13T18:14:00Z',
        lastIp: '100.64.1.7',
        lastUa: 'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/129.0 Safari/537.36',
        failedAttempts: 0,
        openedBy: 'Marco R.',
        createdAt: '2026-10-01T14:00:00Z',
        createdBy: 'Rafael M.',
        version: 1,
      },
      {
        id: 'dev-2',
        name: 'Bay tablet',
        state: 'locked_out',
        locksAt: null,
        lastSeenAt: null,
        lastIp: null,
        lastUa: null,
        failedAttempts: 20,
        openedBy: null,
        createdAt: '2026-10-02T14:00:00Z',
        createdBy: 'Rafael M.',
        version: 2,
      },
      {
        id: 'dev-3',
        name: 'Old tablet',
        state: 'revoked',
        locksAt: null,
        lastSeenAt: null,
        lastIp: null,
        lastUa: null,
        failedAttempts: 0,
        openedBy: null,
        createdAt: '2026-09-02T14:00:00Z',
        createdBy: null,
        version: 4,
      },
    ],
    staff: [
      { id: 'emp-marco', name: 'Marco R.', status: 'active', listed: true, pin: { setAt: '2026-10-01T14:00:00Z', setBy: 'Rafael M.' } },
      { id: 'emp-lena', name: 'Lena K.', status: 'invited', listed: false, pin: null },
      { id: 'emp-old', name: 'Old P.', status: 'inactive', listed: true, pin: null },
    ],
    recent: [
      { at: '2026-10-13T12:00:00Z', action: 'kiosk.unlock', label: 'Unlocked', by: 'Marco R.', deviceName: 'Front desk tablet' },
    ],
    ...over,
  }
}

export function activityFixture(): EmployeeActivity {
  const zero = {
    addons: 0,
    bayMinutes: { avg: null, cars: 0, total: 0 },
    baysStarted: 0,
    bookings: 0,
    checkIns: 0,
    checklistTasks: 0,
    completed: 0,
    payments: { amountCents: null, count: 0 },
    photos: 0,
    pickedUp: 0,
    readyTexts: 0,
    sizeChanges: 0,
    textsSent: 0,
    walkIns: 0,
  }
  const marco = {
    ...zero,
    checkIns: 3,
    baysStarted: 4,
    completed: 4,
    pickedUp: 2,
    bayMinutes: { avg: 41, cars: 4, total: 164 },
    payments: { count: 2, amountCents: 9000 },
    textsSent: 5,
    bookings: 1,
    walkIns: 1,
  }
  return {
    from: '2026-10-13',
    to: '2026-10-13',
    tz: 'America/New_York',
    amounts: true,
    employees: [
      {
        id: 'emp-marco',
        name: 'Marco R.',
        initials: 'MR',
        avatarColor: '#2563EB',
        title: 'Detailer',
        status: 'active',
        totals: marco,
        days: [{ date: '2026-10-13', ...marco }],
      },
      {
        id: 'emp-lena',
        name: 'Lena K.',
        initials: 'LK',
        avatarColor: null,
        title: 'Detailer',
        status: 'invited',
        totals: zero,
        days: [{ date: '2026-10-13', ...zero }],
      },
    ],
  }
}

