// The kiosk's Needs attention alert (ADR 0180 A15, backend src/modules/kiosk/alerts.ts; DEVIATIONS DV-1017): "The shop’s
// internet address may have changed", shown to the shop's Super Admins when a known shop browser was refused from a new
// address and the shop's own network has been quiet since. It is about no appointment: its button and its card open
// Settings → Kiosk, where "PIN tried from a new network" lists the address to add.
export const KIOSK_ADDRESS_ALERT = 'kiosk_address_changed'

/** The page an alert opens instead of a file (null: the alert is about an appointment, or says what it says). */
export const alertPage = (kind: string): string | null => (kind === KIOSK_ADDRESS_ALERT ? '/settings#kiosk' : null)
