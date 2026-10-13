// The commands of the live Operations screen: one method per control. Each checks the session first (a role that may not
// do it gets "Your role can’t ..." and no request), then goes through command() with the Idempotency-Key of its action,
// shows the server's own toast (its title and detail are the design's strings) and lets the touched queries refetch.
// Money and booking commands never patch the cache; the checklist, pickup and add-on toggles may (applyChecklist).
//
// Kiosk mode (ADR 0180, design 6.5, DV-1005): on the shop's unlocked tablet every write names the employee doing it, who
// taps their name in the picker BEFORE the request (and before any optimistic change):
//   every time       the car steps: bay, arrive, start, complete, ready, pickup, prep, move (and the alerts that do them)
//   once per flow    a booking or walk-in (one name for every try of the same sheet), a collect (payment and receipt),
//                    a payment link, a size change
//   sticky per file  texts, add-ons, checklist, photos: the first one asks, then the name sticks to the open file for 2
//                    minutes of activity ("As Marco R. · Change")
//   never            reads, marking a thread read, the price preview
// Cancelling the picker stops the action silently. A signed-in person is never asked.
import type { QueryClient } from '@tanstack/react-query'
import type { Session } from '@/auth/session-model'
import { can, isKiosk } from '@/auth/session-model'
import { KIOSK_DENIED, deniedTitle } from '@/auth/permissions'
import type { PermissionKey } from '@/auth/permissions'
import { Action, command } from '@/data/command'
import type { CommandResult } from '@/data/command'
import { ApiError } from '@/data/http/problem'
import { qk } from '@/data/query'
import type {
  AppointmentFile,
  ApptStatus,
  BillingRes,
  BookingReq,
  CancelRes,
  CommandRes,
  FeeChargeRes,
  OperationsPort,
  PhotoCategory,
  SendMessageReq,
} from '@/data/ports/operations'
import { UploadError } from '@/data/ports/operations'
import type { CollectResult, PaymentsPort } from '@/data/ports/payments'
import type { ToastSpec } from '@/data/toast'
import { businessClock } from '@/lib/tz'
import { applyChecklist } from '@/lib/operations/live/optimistic'
import {
  billingToast,
  cardLinkToast,
  feeChargeToast,
  notChargedNote,
  notChargedToast,
} from '@/lib/operations/live/billing'
import type { BillingActionKey } from '@/lib/operations/live/billing'
import type { NextStepKey } from '@/lib/operations/live/file'

export interface CommandDeps {
  port: OperationsPort
  payments: PaymentsPort
  queryClient: QueryClient
  session(): Session | null
  flash(title: string, desc?: string): void
  now(): number
  tz(): string
  /** F3: a collect's answer names the processor (its invoice's `processing`), also for roles without pay.reports. */
  learnProcessor?(p: 'squarespace' | 'square'): void
  /**
   * Kiosk mode: who is doing this write (the employee picker): the employee id, or null when the picker was cancelled.
   * Undefined (or no `who` at all) for a signed-in person: nobody is asked.
   */
  who?(ask: WhoAsk): Promise<string | null | undefined>
}

/** What the picker asks ("Who’s putting Maria’s Camry in Bay 2?") and the open file a choice sticks to. */
export interface WhoAsk {
  title: string
  sticky?: string
}

/** The employee a write is sent for: `{}` for a signed-in person, `{ actor }` on a kiosk. */
type Who = { actor?: string }

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
    // the shop's kiosk: not "your role" (nobody is signed in) but what a manager must do (DV-1007)
    if (isKiosk(s)) this.d.flash(KIOSK_DENIED.title, KIOSK_DENIED.desc)
    else this.d.flash(deniedTitle(keys[0]!))
    return false
  }

  /** Kiosk: asks who is doing it (null = cancelled: the action stops). A signed-in person: nobody is asked. */
  private async who(ask: WhoAsk): Promise<Who | null> {
    if (!this.d.who || !isKiosk(this.d.session())) return {}
    const id = await this.d.who(ask)
    if (id === undefined) return {}
    return id ? { actor: id } : null
  }

  /** Once per flow: the name asked for an Action stays with it until the action succeeds (renew). */
  private flowWho = new Map<string, string>()
  private async whoFor(action: Action, ask: WhoAsk): Promise<Who | null> {
    const held = this.flowWho.get(action.key)
    if (held && isKiosk(this.d.session())) return { actor: held }
    const w = await this.who(ask)
    if (w?.actor) this.flowWho.set(action.key, w.actor)
    return w
  }
  private endFlow(action: Action): void {
    this.flowWho.delete(action.key)
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
  async advance(s: Subject, title?: string): Promise<boolean> {
    if (!s.step || s.step === 'collect') return false
    if (s.step === 'confirm' || s.step === 'arrive') {
      if (!this.allow('jobs.status', 'sched.edit')) return false
    } else if (!this.allow('jobs.status')) return false
    const w = await this.who({ title: title ?? STEP_TITLE[s.step] })
    if (!w) return false
    const a = this.action('advance:' + s.id + ':' + s.status)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.advance(s.id, s.status, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async assignBay(id: string, bayId: string, title = 'Who’s putting this car in the bay?'): Promise<boolean> {
    if (!this.allow('jobs.status')) return false
    const w = await this.who({ title })
    if (!w) return false
    const a = this.action('assign:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.assignBay(id, bayId, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async prepBay(id: string, title = 'Who’s preparing the bay?'): Promise<boolean> {
    if (!this.allow('jobs.status', 'sched.edit')) return false
    const w = await this.who({ title })
    if (!w) return false
    const a = this.action('prep:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.prepBay(id, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async arrive(id: string, title = 'Who’s checking in this car?'): Promise<boolean> {
    if (!this.allow('jobs.status', 'sched.edit')) return false
    const w = await this.who({ title })
    if (!w) return false
    const a = this.action('arrive:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.arrive(id, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async reschedule(
    id: string,
    start: string,
    override?: { reason: string },
    title = 'Who’s moving this booking?',
  ): Promise<CommandResult<CommandRes> | null> {
    if (!this.allow('sched.edit')) return null
    const w = await this.who({ title })
    if (!w) return null
    const a = this.action('move:' + id + ':' + start)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.reschedule(id, { start, override }, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'edit appointments',
    })
    this.done(a, r)
    return r
  }

  async setPickup(id: string, state: 'collected' | 'pending', title?: string): Promise<boolean> {
    if (!this.allow('jobs.status')) return false
    const w = await this.who({
      title: title ?? (state === 'collected' ? 'Who’s handing over this car?' : 'Who’s undoing the pickup?'),
    })
    if (!w) return false
    const a = this.action('pickup:' + id + ':' + state)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.pickup(id, state, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'change job status',
    })
    return this.done(a, r)
  }

  async notifyReady(id: string, title = 'Who’s telling the client the car is ready?'): Promise<boolean> {
    if (!this.allow('msg.send')) return false
    const w = await this.who({ title })
    if (!w) return false
    const a = this.action('notify:' + id)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.notifyReady(id, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'send messages',
    })
    return this.done(a, r)
  }

  // ---- the file ----------------------------------------------------------------------------------------------------

  /** One task. The toggle shows at once (the cache is patched) and is rolled back if the server refuses. */
  async checklistItem(fileId: string, itemId: string, done: boolean): Promise<boolean> {
    if (!this.allow('jobs.checklist')) return false
    const w = await this.who({ title: 'Who’s working on the checklist?', sticky: fileId })
    if (!w) return false
    const a = this.action('check:' + fileId + ':' + itemId + ':' + done)
    const r = await this.run({
      action: a,
      optimistic: {
        queryKey: qk.ops('file', fileId),
        apply: (cur: unknown) => applyChecklist(cur as AppointmentFile, [itemId], done),
      },
      request: (idem) => this.d.port.checklistItem(fileId, itemId, done, { idempotencyKey: idem, ...w }),
      deny: 'update checklists',
    })
    return this.done(a, r)
  }

  /** A section or "Check all". `quiet` is the section button, which the design does not toast. */
  async checklistBulk(fileId: string, ids: string[], done: boolean, quiet: boolean): Promise<boolean> {
    if (!this.allow('jobs.checklist') || ids.length === 0) return false
    const w = await this.who({ title: 'Who’s working on the checklist?', sticky: fileId })
    if (!w) return false
    const a = this.action('bulk:' + fileId + ':' + ids.length + ':' + done)
    const r = await this.run({
      action: a,
      optimistic: {
        queryKey: qk.ops('file', fileId),
        apply: (cur: unknown) => applyChecklist(cur as AppointmentFile, ids, done),
      },
      request: (idem) => this.d.port.checklistBulk(fileId, ids, done, { idempotencyKey: idem, ...w }),
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
    const w = await this.who({ title: on ? 'Who’s adding the add-on?' : 'Who’s removing the add-on?', sticky: fileId })
    if (!w) return false
    const a = this.action('addon:' + fileId + ':' + serviceId + ':' + on)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.port.setAddon(fileId, serviceId, on, { idempotencyKey: idem, ...w }),
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

  // ---- vehicle sizes and households (ADR 0170) ---------------------------------------------------------------------

  /**
   * "Change size" on the file: the visit is priced again at that size (the server refuses a change that would leave the
   * invoice overpaid, PRICE_CHANGE_OVERPAID, with its own words) and the car on file takes the size.
   */
  async setVisitSize(
    fileId: string,
    vehicleClass: string,
    version: number,
    title = 'Who’s changing the size?',
  ): Promise<boolean> {
    if (!this.allow('sched.edit')) return false
    const w = await this.who({ title })
    if (!w) return false
    const a = this.action('size:' + fileId + ':' + vehicleClass + ':' + version)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) =>
        this.d.port.setVisitSize(fileId, vehicleClass, version, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'edit appointments',
    })
    return this.done(a, r)
  }

  /** The size on file of the client's car only (the visit's price does not move). */
  async setVehicleSize(
    customerId: string,
    vehicleId: string,
    vehicleClass: string | null,
    label: string,
  ): Promise<boolean> {
    if (!this.allow('cli.edit')) return false
    const a = this.action('car-size:' + vehicleId + ':' + vehicleClass)
    const r = await this.run({
      action: a,
      request: (idem) =>
        this.d.port.setVehicleSize(customerId, vehicleId, vehicleClass, { idempotencyKey: idem }),
      onOk: () => ({ title: 'Car size saved', desc: label }),
      deny: 'edit clients',
    })
    return this.done(a, r)
  }

  /** A client shares the membership (priced and covered as the member, the credits shared). */
  async addHousehold(membershipId: string, customerId: string, name: string): Promise<boolean> {
    if (!this.allow('cli.member')) return false
    const a = this.action('hh-add:' + membershipId + ':' + customerId)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.addHousehold(membershipId, customerId, { idempotencyKey: idem }),
      onOk: () => ({ title: 'Added to the membership', desc: name + ' now shares it' }),
      deny: 'manage memberships',
    })
    return this.done(a, r)
  }

  async removeHousehold(membershipId: string, customerId: string, name: string): Promise<boolean> {
    if (!this.allow('cli.member')) return false
    const a = this.action('hh-remove:' + membershipId + ':' + customerId)
    const r = await this.run({
      action: a,
      request: (idem) => this.d.port.removeHousehold(membershipId, customerId, { idempotencyKey: idem }),
      onOk: () => ({ title: 'Removed from the membership', desc: name + ' no longer shares it' }),
      deny: 'manage memberships',
    })
    return this.done(a, r)
  }

  // ---- booking -----------------------------------------------------------------------------------------------------

  /** `action` is the sheet's: created when it opened and reused by every retry of the same booking. */
  async book(body: BookingReq, action: Action, title?: string) {
    if (!this.allow('sched.edit')) return null
    if (body.override && !this.allow('sched.override')) return null
    const w = await this.whoFor(action, {
      title: title ?? (body.walkIn ? 'Who’s checking in this walk-in?' : 'Who’s making this booking?'),
    })
    if (!w) return null
    const r = await this.run({
      action,
      request: (idem) => this.d.port.book(body, { idempotencyKey: idem, ...w }),
      onOk: toast,
      deny: 'edit appointments',
    })
    if (r.ok) {
      this.endFlow(action)
      action.renew()
    }
    return r
  }

  /** The booking sheet closed: its next opening is a new flow (and asks again). */
  closeFlow(action: Action): void {
    this.endFlow(action)
  }

  // ---- messages ----------------------------------------------------------------------------------------------------

  async sendMessage(fileId: string, input: SendMessageReq, first: string) {
    if (!this.allow('msg.send')) return null
    const w = await this.who({ title: 'Who’s texting ' + (first || 'the client') + '?', sticky: fileId })
    if (!w) return null
    const a = this.action('msg:' + fileId + ':' + (input.templateKey ?? input.text))
    const r = await this.run({
      action: a,
      key: qk.messages(),
      invalidate: [qk.ops()],
      request: (idem) => this.d.port.sendMessage(fileId, input, { idempotencyKey: idem, ...w }),
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

  // ---- identity (ADR 0160) -----------------------------------------------------------------------------------------

  /** Clear PIN on the client file: the PIN, the client's links and link sessions and the number's trust end. */
  async clearPin(customerId: string, first: string): Promise<boolean> {
    if (!this.allow('cli.edit')) return false
    const a = this.action('pin:' + customerId)
    const r = await this.run({
      action: a,
      key: qk.ops('identity', customerId),
      request: (idem) => this.d.port.clearPin(customerId, { idempotencyKey: idem }),
      onOk: () => ({
        title: 'Website PIN cleared',
        desc: (first || 'The client') + ' confirms with a texted code next time',
      }),
      deny: 'edit clients',
    })
    return this.done(a, r)
  }

  // ---- cards on file, fees and Square memberships (ADR 0171 wave Q3; DV-903, DV-904, DV-907) -----------------------

  /** Remove a saved card: Square disables it first; the server's refusal (Square not answering, watch-only) changes nothing. */
  async removeCard(customerId: string, cardId: string, label: string): Promise<boolean> {
    if (!this.allow('cli.edit')) return false
    const a = this.action('card-remove:' + cardId)
    const r = await this.run({
      action: a,
      key: qk.ops('cards', customerId),
      invalidate: [qk.ops('file'), qk.payments()],
      request: (idem) => this.d.port.removeCard(customerId, cardId, { idempotencyKey: idem }),
      onOk: () => ({ title: 'Card removed', desc: label + ' can’t be charged any more' }),
      deny: 'edit clients',
    })
    return this.done(a, r)
  }

  /** Text the client a secure page to save a card. A text that could not go is said, not hidden. */
  async cardLink(customerId: string, first: string): Promise<boolean> {
    if (!this.allow('cli.edit')) return false
    const a = this.action('card-link:' + customerId)
    const r = await this.run({
      action: a,
      key: qk.ops('cards', customerId),
      request: (idem) => this.d.port.cardLink(customerId, { idempotencyKey: idem }),
      onOk: (res) => cardLinkToast(first, res),
      deny: 'edit clients',
    })
    return this.done(a, r)
  }

  /** Cancel a booked or confirmed visit; the deposit follows the cancellation rules and the client is texted. */
  async cancelVisit(fileId: string, reason: string): Promise<CancelRes | null> {
    if (!this.allow('sched.cancel')) return null
    const a = this.action('cancel:' + fileId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.port.cancel(fileId, { reason, notify: true }, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'cancel appointments',
    })
    return this.done(a, r) && r.ok ? r.data : null
  }

  /** A no-show (only after the start and the grace period: the server says so otherwise). */
  async noShow(fileId: string): Promise<CancelRes | null> {
    if (!this.allow('sched.cancel')) return null
    const a = this.action('no-show:' + fileId)
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.port.noShow(fileId, { idempotencyKey: idem }),
      onOk: toast,
      deny: 'cancel appointments',
    })
    return this.done(a, r) && r.ok ? r.data : null
  }

  /**
   * Charge a proposed (or declined) fee on its saved card, after the staff member confirmed it. A decline keeps the fee
   * (charged again later as a new attempt); a charge Square has not answered is said and finished by the server's job.
   */
  async chargeFee(fileId: string, chargeId: string): Promise<FeeChargeRes | null> {
    if (!this.allow('pay.collect')) return null
    const a = this.action('fee-charge:' + chargeId)
    const r = await this.run({
      action: a,
      key: qk.ops('fees', fileId),
      invalidate: [qk.ops('file', fileId), qk.payments()],
      request: (idem) => this.d.port.chargeFee(fileId, chargeId, { idempotencyKey: idem }),
      onOk: (res) => feeChargeToast(res.charge),
      deny: 'collect payments',
    })
    return this.done(a, r) && r.ok ? r.data : null
  }

  /**
   * DV-910: "Not charged (checked Square)" on a fee Square never answered (POST /invoices/:id/card-charges/:chargeId/
   * not-charged): the server looks the payment up at Square; found, it is recorded; none, the fee closes as not charged
   * (charge it again or waive it). A refusal is the server's toast; its words come back as `note` for the row.
   */
  async notCharged(
    fileId: string,
    invoiceId: string,
    chargeId: string,
  ): Promise<{ ok: boolean; note: string | null }> {
    if (!this.allow('pay.collect')) return { ok: false, note: null }
    const a = this.action('not-charged:' + chargeId)
    const r = await this.run({
      action: a,
      key: qk.ops('fees', fileId),
      invalidate: [qk.ops('file', fileId), qk.payments()],
      request: (idem) => this.d.payments.notCharged(invoiceId, chargeId, { idempotencyKey: idem }),
      onOk: (res) => notChargedToast(res.charge),
      deny: 'collect payments',
    })
    return { ok: this.done(a, r), note: r.ok ? null : notChargedNote(r.error) }
  }

  async waiveFee(fileId: string, chargeId: string, reason: string): Promise<boolean> {
    if (!this.allow('pay.collect')) return false
    const a = this.action('fee-waive:' + chargeId)
    const r = await this.run({
      action: a,
      key: qk.ops('fees', fileId),
      invalidate: [qk.ops('file', fileId), qk.payments()],
      request: (idem) => this.d.port.waiveFee(fileId, chargeId, reason, { idempotencyKey: idem }),
      onOk: () => ({ title: 'Fee waived', desc: 'Nothing is charged' }),
      deny: 'collect payments',
    })
    return this.done(a, r)
  }

  /**
   * A Square billing action on the membership (pause, resume, cancel at period end and their undo, change tier or size,
   * text the card link, refund the last payment). The server makes the Square call and answers the membership again;
   * its refusals (the state does not fit, Square watch-only or not answering) are its own words.
   */
  async billing(
    membershipId: string,
    customerId: string,
    key: BillingActionKey,
    first: string,
    change?: { planKey: string; planClass?: string },
  ): Promise<boolean> {
    if (!this.allow(key === 'refund-last' ? 'pay.refund' : 'cli.member')) return false
    const a = this.action('billing:' + membershipId + ':' + key + (change ? ':' + change.planKey + ':' + change.planClass : ''))
    const r = await this.run<BillingRes>({
      action: a,
      key: qk.ops('membership', customerId),
      invalidate: [qk.ops('file'), qk.ops('snapshot'), ...(key === 'refund-last' ? [qk.payments()] : [])],
      request: (idem) => {
        const o = { idempotencyKey: idem }
        if (key === 'change') return this.d.port.changeBilling(membershipId, change!, o)
        if (key === 'refund-last') return this.d.port.refundLast(membershipId, o)
        return this.d.port.billing(membershipId, key, o)
      },
      onOk: (res) => billingToast(key, first, res),
      deny: key === 'refund-last' ? 'issue refunds' : 'manage memberships',
    })
    return this.done(a, r)
  }

  // ---- photos ------------------------------------------------------------------------------------------------------

  async uploadPhoto(fileId: string, category: PhotoCategory, file: File): Promise<boolean> {
    if (!this.allow('jobs.checklist')) return false
    const w = await this.who({ title: 'Who’s adding the photo?', sticky: fileId })
    if (!w) return false
    const contentType = file.type || guessType(file.name)
    const a = this.action('photo:' + fileId + ':' + category + ':' + file.name + ':' + file.size)
    const slot = await this.run({
      action: a,
      request: (idem) =>
        this.d.port.presignPhoto(
          fileId,
          { category, contentType, bytes: file.size },
          { idempotencyKey: idem, ...w },
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
      request: (idem) => this.d.port.completePhoto(fileId, slot.data.photoId, { idempotencyKey: idem, ...w }),
      onOk: () => ({ title: 'Photo added', desc: CATEGORY_LABEL[category] }),
      deny: 'update checklists',
    })
    a.renew()
    return done.ok
  }

  // ---- payments ----------------------------------------------------------------------------------------------------

  /**
   * Mark Paid: cash or card for the whole balance. Card money counts at once and waits for its processor to confirm
   * (Squarespace; with Square the reader payment is matched to it).
   */
  async collect(
    invoiceId: string,
    method: 'card' | 'cash',
    who: { first: string; processor?: 'squarespace' | 'square' },
  ): Promise<boolean> {
    if (!this.allow('pay.collect')) return false
    const a = this.action('collect:' + invoiceId)
    // one name for the payment and its receipt
    const w = await this.whoFor(a, { title: 'Who’s taking ' + (who.first ? who.first + '’s' : 'the') + ' payment?' })
    if (!w) return false
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) => this.d.payments.collect(invoiceId, { method }, { idempotencyKey: idem, ...w }),
      deny: 'collect payments',
    })
    if (!r.ok) return false
    this.endFlow(a)
    a.renew()
    const learned = r.data?.invoice?.processing?.processor
    if (learned) this.d.learnProcessor?.(learned)
    const receipt = await this.receipt(invoiceId, w)
    const square = (learned ?? who.processor) === 'square'
    this.d.flash(
      method === 'card' ? (square ? 'Square reader payment recorded' : 'Card payment recorded') : 'Payment collected',
      (method === 'card' ? 'Waiting for ' + (square ? 'Square' : 'Squarespace') + ' to confirm · ' : '') +
        receiptLine(receipt, who.first),
    )
    return true
  }

  private async receipt(invoiceId: string, w: Who) {
    try {
      return await this.d.payments.sendReceipt(invoiceId, w.actor ? { actor: w.actor } : undefined)
    } catch {
      return null
    }
  }

  /** A Squarespace checkout or invoice link texted to the client. The server answers a wrong host with its own text. */
  async sendLink(invoiceId: string, url: string): Promise<{ ok: boolean; error?: ApiError }> {
    if (!this.allow('pay.collect')) return { ok: false }
    const a = this.action('link:' + invoiceId)
    const w = await this.whoFor(a, { title: 'Who’s sending the payment link?' })
    if (!w) return { ok: false }
    const r = await this.run({
      action: a,
      invalidate: [qk.payments()],
      request: (idem) =>
        this.d.payments.collect(
          invoiceId,
          { method: 'payment_link', url: url.trim() || undefined },
          { idempotencyKey: idem, ...w },
        ),
      onOk: (c: CollectResult) => {
        const learned = c.invoice?.processing?.processor
        if (learned) this.d.learnProcessor?.(learned)
        return this.linkToast(c)
      },
      deny: 'collect payments',
    })
    if (r.ok) {
      this.endFlow(a)
      a.renew()
    }
    return r.ok ? { ok: true } : { ok: false, error: r.error }
  }

  private linkToast(c: CollectResult): ToastSpec {
    return {
      title: 'Payment link sent',
      desc:
        // DV-809: with Square the server makes the link; a plain Square link (pay links off) is shown to copy
        (c.paymentLink?.sms === 'queued' ? 'Secure link via SMS' : 'Link saved · the client could not be texted') +
        (c.paymentLink?.url && c.paymentLink.provider && c.paymentLink.provider !== 'squarespace'
          ? ' · ' + c.paymentLink.url
          : ''),
    }
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

/** The picker's question for each car step (the screen passes a fuller one naming the car when it can). */
const STEP_TITLE: Record<Exclude<NextStepKey, null>, string> = {
  confirm: 'Who’s confirming this booking?',
  arrive: 'Who’s checking in this car?',
  start: 'Who’s starting this car?',
  complete: 'Who finished this car?',
  collect: 'Who’s taking the payment?',
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
