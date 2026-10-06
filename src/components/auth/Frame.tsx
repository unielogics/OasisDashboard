// The page frame of the login family and the boot splash: the designs' root wrapper, header (logo tile, wordmark)
// and a centred body. The screens' global CSS (tokens, fonts, input and button rules) is injected from the Payments
// sheet, whose rules are the ones the Payments card and the Settings drawer inputs were designed against.
import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { ScreenStyle } from '@/dc/ScreenStyle'
import { screenCss } from '@generated/payments.styles'
import { readThemeCache } from '@/data/theme'
import type { Theme } from '@/data/http/auth-types'
import { headerStyle, logoTileStyle, rootStyle, wordmarkStyle, wordmarkSubStyle } from './styles'

export function LogoMark() {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '13px', flex: 'none' }}>
      <div style={logoTileStyle}>
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none">
          <path d="M5 13c0-3.5 2.5-7 7-7s7 3.5 7 7" stroke="#fff" strokeWidth="2.1" strokeLinecap="round" />
          <path
            d="M3 16.5c1.2-.9 2.1-.9 3.3 0 1.2.9 2.1.9 3.3 0 1.2-.9 2.1-.9 3.3 0 1.2.9 2.1.9 3.3 0 1.2-.9 2.1-.9 3.3 0"
            stroke="#fff"
            strokeWidth="2.1"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="12" cy="12.5" r="1.6" fill="#fff" />
        </svg>
      </div>
      <div style={{ lineHeight: 1.05 }}>
        <div style={wordmarkStyle}>Oasis Auto Spa</div>
        <div style={wordmarkSubStyle}>Back office</div>
      </div>
    </div>
  )
}

/** The theme cache, read after mount (the server render has no localStorage). Light until then, like the designs. */
export function useCachedTheme(): Theme {
  const [theme, setTheme] = useState<Theme>('light')
  useEffect(() => setTheme(readThemeCache() ?? 'light'), [])
  return theme
}

interface FrameProps {
  children: ReactNode
  /** The designs' header bar (logo tile and wordmark). The boot splash shows only the centred mark. */
  header?: boolean
}

export function AuthFrame({ children, header = true }: FrameProps) {
  const theme = useCachedTheme()
  return (
    <>
      <ScreenStyle id="oasis-auth" css={screenCss} />
      <div data-theme={theme} data-screen-label="Oasis" style={rootStyle}>
        {header && (
          <header style={headerStyle}>
            <LogoMark />
          </header>
        )}
        <main
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '26px',
            overflowY: 'auto',
          }}
        >
          {children}
        </main>
      </div>
    </>
  )
}
