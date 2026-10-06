// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest'
import {
  THEME_BOOT_SCRIPT,
  THEME_KEY,
  adoptServerTheme,
  applyDocumentTheme,
  clearThemeCache,
  persistTheme,
  readThemeCache,
  resolveTheme,
  writeThemeCache,
} from './theme'

beforeEach(() => {
  localStorage.clear()
  document.documentElement.removeAttribute('data-theme')
})

describe('theme cache', () => {
  it('reads only valid values and survives storage that throws', () => {
    expect(readThemeCache()).toBeNull()
    localStorage.setItem(THEME_KEY, 'dark')
    expect(readThemeCache()).toBe('dark')
    localStorage.setItem(THEME_KEY, 'purple')
    expect(readThemeCache()).toBeNull()
    const boom = {
      getItem: () => {
        throw new Error('blocked')
      },
      setItem: () => {
        throw new Error('blocked')
      },
      removeItem: () => {
        throw new Error('blocked')
      },
    }
    expect(readThemeCache(boom)).toBeNull()
    expect(() => writeThemeCache('dark', boom)).not.toThrow()
    expect(() => clearThemeCache(boom)).not.toThrow()
    expect(readThemeCache(null)).toBeNull()
  })
  it('the server preference wins, then the cache, then light', () => {
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(resolveTheme(null, 'dark')).toBe('dark')
    expect(resolveTheme(undefined, null)).toBe('light')
  })
  it('adoptServerTheme overwrites the cache with the server value and mirrors <html>', () => {
    writeThemeCache('light')
    const r = adoptServerTheme('dark')
    expect(r).toEqual({ theme: 'dark', changed: true })
    expect(readThemeCache()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
  it('with no server value the cache is kept and nothing is reported as changed', () => {
    writeThemeCache('dark')
    expect(adoptServerTheme(null)).toEqual({ theme: 'dark', changed: false })
    expect(readThemeCache()).toBe('dark')
    clearThemeCache()
    expect(adoptServerTheme(null)).toEqual({ theme: 'light', changed: false })
    expect(readThemeCache()).toBeNull()
  })
  it('the boot script sets <html data-theme> from the cache and ignores garbage', () => {
    localStorage.setItem(THEME_KEY, 'dark')
    new Function(THEME_BOOT_SCRIPT)()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    document.documentElement.removeAttribute('data-theme')
    localStorage.setItem(THEME_KEY, '"><script>')
    new Function(THEME_BOOT_SCRIPT)()
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)
  })
  it('applyDocumentTheme tolerates a missing document', () => {
    expect(() => applyDocumentTheme('dark', null)).not.toThrow()
  })
})

describe('persistTheme (optimistic, PUT /me/preferences)', () => {
  it('applies at once and keeps the choice when the save succeeds', async () => {
    const put = vi.fn(async () => undefined)
    expect(await persistTheme('dark', 'light', { put })).toBe(true)
    expect(put).toHaveBeenCalledWith('dark')
    expect(readThemeCache()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })
  it('restores the previous theme and tells the screen when the save fails', async () => {
    writeThemeCache('light')
    const onRollback = vi.fn()
    const ok = await persistTheme('dark', 'light', {
      put: async () => {
        throw new Error('offline')
      },
      onRollback,
    })
    expect(ok).toBe(false)
    expect(readThemeCache()).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(onRollback).toHaveBeenCalledWith('light')
  })
})
