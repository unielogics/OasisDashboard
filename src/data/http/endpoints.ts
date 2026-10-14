// Typed calls for the identity endpoints (contract: auth-types.ts). Everything else goes through DataPorts.
import type { ApiClient } from './client'
import type {
  ChangePasswordRequest,
  ForgotRequest,
  InviteAcceptRequest,
  KioskMe,
  KioskPerson,
  KioskStatus,
  LoginRequest,
  MeResponse,
  NowResponse,
  ResetRequest,
  SignedInResponse,
  Theme,
} from './auth-types'

export interface AuthApi {
  login(body: LoginRequest): Promise<SignedInResponse>
  logout(): Promise<void>
  csrf(): Promise<{ csrfToken: string }>
  acceptInvite(body: InviteAcceptRequest): Promise<SignedInResponse>
  forgot(body: ForgotRequest): Promise<{ accepted: true }>
  reset(body: ResetRequest): Promise<void>
  changePassword(body: ChangePasswordRequest): Promise<void>
}

export interface MeApi {
  get(signal?: AbortSignal): Promise<MeResponse>
  setPreferences(theme: Theme, opts?: { idempotencyKey?: string }): Promise<unknown>
  viewAs(roleId: string | null, opts?: { idempotencyKey?: string }): Promise<MeResponse>
  now(signal?: AbortSignal): Promise<NowResponse>
}

export function createAuthApi(c: ApiClient): AuthApi {
  return {
    async login(body) {
      const r = await c.post<SignedInResponse>('/auth/login', body, { public: true })
      c.csrf.set(r.csrfToken)
      return r
    },
    async logout() {
      await c.post<void>('/auth/logout', undefined, { retries: 0 })
      c.csrf.set(null)
    },
    csrf: () => c.get('/auth/csrf'),
    async acceptInvite(body) {
      const r = await c.post<SignedInResponse>('/auth/invite/accept', body, { public: true })
      c.csrf.set(r.csrfToken)
      return r
    },
    forgot: (body) => c.post('/auth/password/forgot', body, { public: true }),
    reset: (body) => c.post('/auth/password/reset', body, { public: true }),
    changePassword: (body) => c.post('/auth/password/change', body),
  }
}

export function createMeApi(c: ApiClient): MeApi {
  return {
    async get(signal) {
      const me = await c.get<MeResponse>('/me', { signal })
      c.csrf.set(me.csrfToken)
      return me
    },
    setPreferences: (theme, opts) => c.put('/me/preferences', { theme }, opts),
    async viewAs(roleId, opts) {
      const me = await c.post<MeResponse>('/me/view-as', { roleId }, opts)
      c.csrf.set(me.csrfToken)
      return me
    },
    now: (signal) => c.get<NowResponse>('/meta/now', { signal }),
  }
}

/** The kiosk's own endpoints (ADR 0180, api-spec 31.2). Status and unlock are public; the rest need an unlocked kiosk. */
export interface KioskApi {
  status(signal?: AbortSignal): Promise<KioskStatus>
  /** An employee's 8-digit PIN, at the shop; the answer sets the kiosk session cookie. The PIN is never kept or logged here. */
  unlock(pin: string): Promise<KioskMe>
  me(signal?: AbortSignal): Promise<KioskMe>
  staff(signal?: AbortSignal): Promise<{ items: KioskPerson[] }>
  /** POST /kiosk/lock: the keypad shows again. */
  lock(): Promise<void>
}

export function createKioskApi(c: ApiClient): KioskApi {
  return {
    status: (signal) => c.get<KioskStatus>('/kiosk/status', { public: true, signal, retries: 1 }),
    async unlock(pin) {
      const r = await c.post<KioskMe>('/kiosk/unlock', { pin }, { public: true })
      c.csrf.set(r.csrfToken)
      return r
    },
    async me(signal) {
      const r = await c.get<KioskMe>('/kiosk/me', { signal })
      c.csrf.set(r.csrfToken)
      return r
    },
    staff: (signal) => c.get('/kiosk/staff', { signal }),
    async lock() {
      await c.post<void>('/kiosk/lock', undefined, { retries: 0 })
      c.csrf.set(null)
    },
  }
}
