// Hand-written contract for the identity endpoints (backend design 5.1 / api-spec 14). It mirrors the response
// schemas of the backend identity module so that swapping in the generated types is a type alias change:
//
//   import type { paths } from './schema'
//   export type MeResponse = paths['/api/v1/me']['get']['responses'][200]['content']['application/json']
//
// until `pnpm gen:api` has those paths, keep this file the single place that names them.
import type { paths } from './schema'

export type Theme = 'light' | 'dark'
export type MoneyKind = 'refund' | 'adjust' | 'credit'

export interface PermissionState {
  on: boolean
  /** Integer cents; null = no limit. Present only for money permissions that are on. */
  limit?: number | null
}

export interface ViewAsOption {
  id: string
  key: string | null
  name: string
  locked: boolean
  /** Integer cents; null = no limit. */
  limits: Partial<Record<MoneyKind, number | null>>
}

export interface MeResponse {
  user: { id: string; email: string }
  employee: {
    id: string
    first: string
    last: string
    name: string
    initials: string
    title: string
    phone: string
    email: string | null
    avatarColor: string | null
  }
  /** Effective roles (the viewed role while view-as is active). */
  roles: { id: string; key: string | null; name: string }[]
  displayRole: string
  /** The REAL person is a Super Admin (so they can use view-as); not the effective authority. */
  isSuperAdmin: boolean
  permissions: Record<string, PermissionState>
  limits: Partial<Record<MoneyKind, number | null>>
  rbacVersion: number
  preferences: { theme: Theme | null }
  viewAs: {
    active: boolean
    canViewAs: boolean
    roleId: string | null
    roleName: string | null
    options: ViewAsOption[]
  }
  csrfToken: string
  session: { expiresAt: string }
  /** Not sent by the identity module today; the session loader falls back to GET /meta/now. */
  serverTime?: string
  businessTz?: string
  /** Optional runtime flags (the review asked for a source for `devTools`; absent means false). */
  config?: { devTools?: boolean }
}

export interface SignedInResponse {
  user: { id: string; employeeId: string; email: string; name: string }
  csrfToken: string
}

export type NowResponse = paths['/api/v1/meta/now']['get']['responses'][200]['content']['application/json']

export interface LoginRequest {
  email: string
  password: string
}
export interface InviteAcceptRequest {
  token: string
  /** Required: employees may have no email until they accept. */
  email: string
  password: string
}
export interface ForgotRequest {
  email: string
}
export interface ResetRequest {
  token: string
  password: string
}
export interface ChangePasswordRequest {
  currentPassword: string
  newPassword: string
}

/** The identity endpoints, as the dashboard calls them (paths are relative to /api/v1). */
export interface AuthEndpoints {
  'POST /auth/login': { body: LoginRequest; response: SignedInResponse }
  'POST /auth/logout': { body: undefined; response: void }
  'GET /auth/csrf': { body: undefined; response: { csrfToken: string } }
  'POST /auth/invite/accept': { body: InviteAcceptRequest; response: SignedInResponse }
  'POST /auth/password/forgot': { body: ForgotRequest; response: { accepted: true } }
  'POST /auth/password/reset': { body: ResetRequest; response: void }
  'POST /auth/password/change': { body: ChangePasswordRequest; response: void }
  'GET /me': { body: undefined; response: MeResponse }
  'PUT /me/preferences': { body: { theme: Theme }; response: { theme: Theme } | void }
  'POST /me/view-as': { body: { roleId: string | null }; response: MeResponse }
  'GET /meta/now': { body: undefined; response: NowResponse }
}

/** Problem codes the identity module returns that the UI handles specifically. */
export const AUTH_CODES = {
  invalidCredentials: 'INVALID_CREDENTIALS',
  throttled: 'LOGIN_THROTTLED',
  accountDisabled: 'ACCOUNT_DISABLED',
  csrfInvalid: 'CSRF_INVALID',
  inviteInvalid: 'INVITE_INVALID',
  resetInvalid: 'RESET_INVALID',
  emailTaken: 'EMAIL_TAKEN',
  unauthenticated: 'UNAUTHENTICATED',
  validation: 'VALIDATION_FAILED',
  forbidden: 'FORBIDDEN',
  versionConflict: 'VERSION_CONFLICT',
  staleState: 'STALE_STATE',
} as const
