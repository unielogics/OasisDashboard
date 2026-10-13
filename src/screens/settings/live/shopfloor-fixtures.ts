// Fixtures of Settings → Shop floor (ADR 0180): GET /kiosk and GET /reports/employee-activity as the backend answers
// them (api-spec 31.3, 31.4). Shared by the view-model and render tests. Not shipped.
import type { EmployeeActivity, KioskOverview } from '@/data/ports/kiosk-api'

export function overviewFixture(over: Partial<KioskOverview> = {}): KioskOverview {
  return {
    enabled: false,
    version: 3,
    code: { set: true, setAt: '2026-10-01T14:00:00Z', setBy: 'Rafael M.', ageDays: 12 },
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
        createdAt: '2026-09-02T14:00:00Z',
        createdBy: null,
        version: 4,
      },
    ],
    staff: [
      { id: 'emp-marco', name: 'Marco R.', status: 'active', listed: true },
      { id: 'emp-lena', name: 'Lena K.', status: 'invited', listed: false },
      { id: 'emp-old', name: 'Old P.', status: 'inactive', listed: true },
    ],
    recent: [{ at: '2026-10-13T12:00:00Z', action: 'kiosk.unlock', label: 'Unlocked', by: null, deviceName: 'Front desk tablet' }],
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

