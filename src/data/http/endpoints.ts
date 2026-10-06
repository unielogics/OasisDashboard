// Typed calls for the identity endpoints (contract: auth-types.ts). Everything else goes through DataPorts.
import type { ApiClient } from './client'
import type {
  ChangePasswordRequest,
  ForgotRequest,
  InviteAcceptRequest,
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
