import { describe, expect, it } from 'vitest'
import { KIOSK_ADDRESS_ALERT, alertPage } from './kiosk-alert'

describe('the kiosk alert (ADR 0180 A15)', () => {
  it('“The shop’s internet address may have changed” opens Settings → Kiosk; every other alert keeps its own way', () => {
    expect(KIOSK_ADDRESS_ALERT).toBe('kiosk_address_changed')
    expect(alertPage('kiosk_address_changed')).toBe('/settings#kiosk')
    for (const k of ['new_reply', 'awaiting_processor', 'sms_device_down', 'running_late']) expect(alertPage(k)).toBeNull()
  })
})
