import { useMemo } from 'react'
import { api } from '@/data/http/client'
import { createAuthApi } from '@/data/http/endpoints'
import type { AuthApi } from '@/data/http/endpoints'

/** The identity endpoints on the shared client; a test passes its own implementation through the `auth` prop. */
export const useAuthApi = (override?: AuthApi): AuthApi =>
  useMemo(() => override ?? createAuthApi(api), [override])
