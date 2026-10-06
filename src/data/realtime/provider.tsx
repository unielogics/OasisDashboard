import { useEffect } from 'react'
import type { ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useSession } from '@/auth/session'
import { qk } from '../query'
import { toasts } from '../toast'
import { InvalidationCoalescer, invalidateEverything, keysForEvent, refreshActive } from './invalidation'
import { RealtimeClient } from './sse'
import type { EventSourceLike, Timers } from './sse'
import { randomUnit } from '@/lib/id'

interface Props {
  children?: ReactNode
  /** Test seams. */
  createSource?: (url: string) => EventSourceLike
  timers?: Timers
}

/** Runs the SSE client while a person is signed in; events invalidate query families, 'down' toasts and polls. */
export function RealtimeProvider({ children, createSource, timers }: Props) {
  const qc = useQueryClient()
  const { session } = useSession()
  const userId = session.user.id

  useEffect(() => {
    const coalescer = new InvalidationCoalescer(qc, 250, timers)
    const client = new RealtimeClient({
      createSource,
      timers,
      random: randomUnit,
      onEvent: (e) => coalescer.push(keysForEvent(e)),
      onResync: () => void invalidateEverything(qc),
      onStatus: (s, prev) => {
        if (s === 'down' && prev !== 'down') toasts.emit({ title: 'Connection lost', desc: 'retrying' })
      },
      onPoll: () => void refreshActive(qc),
      // The stream keeps failing before it ever opens: ask /me, whose 401 sends the person to /login.
      onSuspectAuth: () => void qc.invalidateQueries({ queryKey: qk.me }),
    })
    client.start()
    const wake = () => client.reconnectNow()
    const onVisible = () => {
      if (document.visibilityState === 'visible') wake()
    }
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', wake)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', wake)
      client.stop()
      coalescer.dispose()
    }
  }, [qc, userId, createSource, timers])

  return <>{children}</>
}
