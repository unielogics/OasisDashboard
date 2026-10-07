// The commands of the live Operations screen: one method per control. Each checks the session first (a role that may not
// do it gets "Your role can’t ..." and no request), then goes through command() with the Idempotency-Key of its action,
// shows the server's own toast (its title and detail are the design's strings) and lets the touched queries refetch.
// Money and booking commands never patch the cache; the checklist, pickup and add-on toggles may (applyChecklist).
import type { QueryClient } from '@tanstack/react-query'
import type { Session } from '@/auth/session-model'
import { can } from '@/auth/session-model'
import { deniedTitle } from '@/auth/permissions'
import type { PermissionKey } from '@/auth/permissions'
import { Action, command } from '@/data/command'
import type { CommandResult } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import type {
  AppointmentFile,
  ApptStatus,
  BookingReq,
  CommandRes,
  OperationsPort,
  PhotoCategory,
  SendMessageReq,
} from '@/data/ports/operations'
import { UploadError } from '@/data/ports/operations'
import type { CollectResult, PaymentsPort } from '@/data/ports/payments'
import type { ToastSpec } from '@/data/toast'
import { businessClock } from '@/lib/tz'
import { applyChecklist } from '@/lib/operations/live/optimistic'
import type { NextStepKey } from '@/lib/operations/live/file'

export interface CommandDeps {
  port: OperationsPort
  payments: PaymentsPort
  queryClient: QueryClient
  session(): Session | null
  flash(title: string, desc?: string): void
  now(): number
  tz(): string
}

/** What a card or file tells a command about the appointment it acts on. */
export interface Subject {
  id: string
  status: ApptStatus
  step: NextStepKey
}

const toast = (r: { toast: { title: string; detail: string } }): ToastSpec => ({
  title: r.toast.title,
  desc: r.toast.detail,
})

export class OpsCommands {
  private actions = new Map<string, Action>()
  constructor(private d: CommandDeps) {}

  // ---- plumbing ----------------------------------------------------------------------------------------------------

  /** True when the session holds one of the permissions; otherwise toasts "Your role can’t ..." and says no. */
  allow(...keys: PermissionKey[]): boolean {
    const s = this.d.session()
    if (keys.some((k) => can(s, k))) return true
    this.d.flash(deniedTitle(keys[0]!))
    return false
  }

  action(name: string): Action {
    let a = this.actions.get(name)
    if (!a) this.actions.set(name, (a = new Action()))
    return a
  }

  private run<T>(o: {
    action?: Action
    request: (idem: string) => Promise<T>
    onOk?: (r: T) => ToastSpec | void
    deny?: string
    invalidate?: Array<readonly unknown[]>
    optimistic?: Parameters<typeof command<T>>[0]['optimistic']
    key?: readonly unknown[]
  }): Promise<CommandResult<T>> {
    return command<T>({
      key: o.key ?? qk.ops(),
      idempotencyKey: o.action?.key,
      queryClient: this.d.queryClient,
      denyLabel: o.deny,
      request: o.request,
      onOk: o.onOk,
      invalidate: o.invalidate as never,
      optimistic: o.optimistic,
      toast: (t) => this.d.flash(t.title, t.desc),
    })
  }

  private done(a: Action | undefined, r: CommandResult<unknown>): boolean {
    if (r.ok) a?.renew()
    return r.ok
  }

  // ---- lifecycle ---------------------------------------------------------------------------------------------------

  /** The next step of the status the screen showed (expectedStatus makes a stale screen a 409, never a skipped state). */
  async advance(s: Subject): Promise<boolean> {
    if (!s.step || s.step === 'collect') return false
    if (s.step === 'confirm' || s.step === 'arrive') {
      if (!this.allow('jobs.status', 'sched.edit')) return false
    } else if (!this.allow('jobs.status')) return false
    const a = this.action('advance:' + s.id + ':' + s.status)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.advance(s.id, s.status, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async assignBay(id: string, bayId: string): Promise<boolean> {
    if (!this.allow('jobs.status')) return false
    const a = this.action('assign:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.assignBay(id, bayId, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async prepBay(id: string): Promise<boolean> {
    if (!this.allow('jobs.status', 'sched.edit')) return false
    const a = this.action('prep:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.prepBay(id, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async arrive(id: string): Promise<boolean> {
    if (!this.allow('jobs.status', 'sched.edit')) return false
    const a = this.action('arrive:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.arrive(id, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async reschedule(
    id: string,
    start: string,
    override?: { reason: string },
  ): Promise<CommandResult<CommandRes> | null> {
    if (!this.allow('sched.edit')) return null
    const a = this.action('move:' + id + ':' + start)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.reschedule(id, { start, override }, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'edit appointments',
    })
    this.done(a, r)
    return r
  }

  async setPickup(id: string, state: 'collected' | 'pending'): Promise<boolean> {
    if (!this.allow('jobs.status')) return false
    const a = this.action('pickup:' + id + ':' + state)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.pickup(id, state, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async notifyReady(id: string): Promise<boolean> {
    if (!this.allow('msg.send')) return false
    const a = this.action('notify:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.notifyReady(id, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'send messages',
    })
    return this.done(a, r)
  }

  // ---- the file ----------------------------------------------------------------------------------------------------

  /** One task. The toggle shows at once (the cache is patched) and is rolled back if the server refuses. */
  async checklistItem(fileId: string, itemId: string, done: boolean): Promise<boolean> {
    if (!this.allow('jobs.checklist')) return false
    const a = this.action('check:' + fileId + ':' + itemId + ':' + done)
    const r = await this.run({
      action: a,
      optimistic: {
        queryKey: qk.ops('file', fileId),
        apply: (cur: unknown) => applyChecklist(cur as AppointmentFile, [itemId], done),
      },
      request: (idem) => this.d.port.checklistItem(fileId, itemId, done, { idempotencyKey: idem }),
      deny: 'update checklists',
    })
    return this.done(a, r)
  }

  /** A section or "Check all". `quiet` is the section button, which the design does not toast. */
  async checklistBulk(fileId: string, ids: string[], done: boolean, quiet: boolean): Promise<boolean> {
    if (!this.allow('jobs.checklist') || ids.length === 0) return false
    const a = this.action('bulk:' + fileId + ':' + ids.length + ':' + done)
    const r = await this.run({
      action: a,
      optimistic: {
        queryKey: qk.ops('file', fileId),
        apply: (cur: unknown) => applyChecklist(cur as AppointmentFile, ids, done),
      },
      request: (idem) => this.d.port.checklistBulk(fileId, ids, done, { idempotencyKey: idem }),
      onOk: () =>
        quiet
          ? undefined
          : {
              title: done ? 'All tasks checked' : 'Checklist cleared',
              desc: ids.length + (ids.length === 1 ? ' task ' : ' tasks ') + (done ? 'marked done' : 'reset'),
            },
      deny: 'update checklists',
    })
    return this.done(a, r)
  }

  /** Add-on on or off. A removal that would overpay the invoice is a 409 whose toast is the server's. */
  async setAddon(fileId: string, serviceId: string, on: boolean): Promise<boolean> {
    if (!this.allow('sched.edit')) return false
    const a = this.action('addon:' + fileId + ':' + serviceId + ':' + on)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.port.setAddon(fileId, serviceId, on, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'edit appointments',
    })
    return this.done(a, r)
  }

  async applyPerk(fileId: string): Promise<boolean> {
    if (!this.allow('cli.member')) return false
    const a = this.action('perk:' + fileId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.port.applyPerk(fileId, { idempotencyKey: idem }),
      onOk: (p) => ({
        title: 'Credit applied',
        desc:
          p.credits.left === null
            ? 'Membership perk redeemed'
            : p.credits.left + ' credit' + (p.credits.left === 1 ? '' : 's') + ' left this cycle',
      }),
      deny: 'manage memberships',
    })
    return this.done(a, r)
  }

  // ---- booking -----------------------------------------------------------------------------------------------------

  /** `action` is the sheet's: created when it opened and reused by every retry of the same booking. */
  async book(body: BookingReq, action: Action) {
    if (!this.allow('sched.edit')) return null
    if (body.override && !this.allow('sched.override')) return null
    const r = await this.run({
      action,
      request: (idem) => this.d.port.book(body, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'edit appointments',
    })
    if (r.ok) action.renew()
    return r
  }

  // ---- messages ----------------------------------------------------------------------------------------------------

  async sendMessage(fileId: string, input: SendMessageReq, first: string) {
    if (!this.allow('msg.send')) return null
    const a = this.action('msg:' + fileId + ':' + (input.templateKey ?? input.text))
    const r = await this.run({
      action: a,
      key: qk.messages(),
      invalidate: [qk.ops()],
      request: (idem) => this.d.port.sendMessage(fileId, input, { idempotencyKey: idem }),
      onOk: (m) => ({
        title: 'Message sent',
        desc: m.held
          ? 'Held for quiet hours until ' +
            (m.holdUntil ? businessClock(Date.parse(m.holdUntil), this.d.tz()) : 'morning')
          : 'Queued via SMS to ' + first,
      }),
      deny: 'send messages',
    })
    if (r.ok) a.renew()
    return r
  }

  async markRead(customerId: string): Promise<boolean> {
    if (!can(this.d.session(), 'msg.send')) return false
    const r = await command({
      key: qk.messages(),
      invalidate: [qk.ops()],
      queryClient: this.d.queryClient,
      request: (idem) => this.d.port.markRead(customerId, { idempotencyKey: idem }),
      toast: () => undefined,
    })
    return r.ok
  }

  // ---- photos ------------------------------------------------------------------------------------------------------

  async uploadPhoto(fileId: string, category: PhotoCategory, file: File): Promise<boolean> {
    if (!this.allow('jobs.checklist')) return false
    const contentType = file.type || guessType(file.name)
    const a = this.action('photo:' + fileId + ':' + category + ':' + file.name + ':' + file.size)
    const slot = await this.run({
      action: a,
      request: (idem) =>
        this.d.port.presignPhoto(
          fileId,
          { category, contentType, bytes: file.size },
          { idempotencyKey: idem },
        ),
      deny: 'update checklists',
    })
    if (!slot.ok) return false
    try {
      await this.d.port.uploadToSlot(slot.data.upload, file)
    } catch (e) {
      this.d.flash(
        'Photo not added',
        e instanceof UploadError ? e.message : 'The photo could not be uploaded.',
      )
      return false
    }
    const done = await this.run({
      request: () => this.d.port.completePhoto(fileId, slot.data.photoId),
      onOk: () => ({ title: 'Photo added', desc: CATEGORY_LABEL[category] }),
      deny: 'update checklists',
    })
    a.renew()
    return done.ok
  }

  // ---- payments ----------------------------------------------------------------------------------------------------

  /** Mark Paid: cash or card for the whole balance. Card money counts at once and waits for Squarespace to confirm. */
  async collect(invoiceId: string, method: 'card' | 'cash', who: { first: string }): Promise<boolean> {
    if (!this.allow('pay.collect')) return false
    const a = this.action('collect:' + invoiceId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.payments.collect(invoiceId, { method }, { idempotencyKey: idem }),
      deny: 'collect payments',
    })
    if (!r.ok) return false
    a.renew()
    const receipt = await this.receipt(invoiceId)
    this.d.flash(
      method === 'card' ? 'Card payment recorded' : 'Payment collected',
      (method === 'card' ? 'Waiting for Squarespace to confirm · ' : '') + receiptLine(receipt, who.first),
    )
    return true
  }

  private async receipt(invoiceId: string) {
    try {
      return await this.d.payments.sendReceipt(invoiceId)
    } catch {
      return null
    }
  }

  /** A Squarespace checkout or invoice link texted to the client. The server answers a wrong host with its own text. */
  async sendLink(invoiceId: string, url: string): Promise<{ ok: boolean; error?: ApiError }> {
    if (!this.allow('pay.collect')) return { ok: false }
    const a = this.action('link:' + invoiceId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) =>
        this.d.payments.collect(
          invoiceId,
          { method: 'payment_link', url: url.trim() || undefined },
          { idempotencyKey: idem },
        ),
      onOk: (c: CollectResult) => ({
        title: 'Payment link sent',
        desc:
          c.paymentLink?.sms === 'queued'
            ? 'Secure link via SMS'
            : 'Link saved · the client could not be texted',
      }),
      deny: 'collect payments',
    })
    if (r.ok) a.renew()
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  /** "Unpaid": reverses the last payment through the ledger (a void), never by editing the invoice. */
  async unpay(appointmentId: string): Promise<boolean> {
    if (!this.allow('pay.void')) return false
    const a = this.action('unpay:' + appointmentId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: async (idem) => {
        const file = await this.d.port.appointment(appointmentId)
        if (!file.invoice)
          throw new ApiError({ status: 409, title: 'No invoice', detail: 'This job has no invoice.' })
        const inv = await this.d.payments.invoice(file.invoice.invoiceId)
        const pay = inv.ledger.find((e) => e.type === 'pay' && !e.voided && e.status !== 'denied')
        if (!pay)
          throw new ApiError({
            status: 409,
            title: 'Nothing to reverse',
            detail: 'No payment is recorded on this invoice.',
          })
        return this.d.payments.voidPayment(inv.id, pay.id, { idempotencyKey: idem })
      },
      onOk: () => ({ title: 'Marked unpaid', desc: 'Balance reopened' }),
      deny: 'mark payments unpaid',
    })
    return this.done(a, r)
  }
}

const CATEGORY_LABEL: Record<PhotoCategory, string> = {
  arrival: 'Arrival',
  before: 'Before',
  after: 'After',
  issue: 'Damage / Issues',
}

function guessType(name: string): string {
  const ext = name.toLowerCase().split('.').pop()
  return ext === 'png'
    ? 'image/png'
    : ext === 'webp'
      ? 'image/webp'
      : ext === 'heic' || ext === 'heif'
        ? 'image/heic'
        : 'image/jpeg'
}

/** What the receipt SMS and email actually did (only the channels that queued are named). */
export function receiptLine(r: { sms: string; email: string } | null, first: string): string {
  if (!r) return 'Receipt not sent · try Send receipt in Payments'
  const sent = [r.sms === 'queued' ? 'SMS' : null, r.email === 'queued' ? 'email' : null].filter(Boolean)
  return sent.length
    ? 'Receipt sent via ' + sent.join(' + ')
    : 'No receipt sent · ' + first + ' has no SMS or email to reach'
}
