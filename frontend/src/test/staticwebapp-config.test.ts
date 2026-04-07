import { describe, it, expect } from 'vitest'
import config from '../../public/staticwebapp.config.json'

function parseCSP(csp: string): Map<string, string[]> {
  const directives = new Map<string, string[]>()
  for (const part of csp.split(';')) {
    const trimmed = part.trim()
    if (!trimmed) continue
    const [directive, ...values] = trimmed.split(/\s+/)
    directives.set(directive, values)
  }
  return directives
}

describe('staticwebapp.config.json CSP', () => {
  const csp = config.globalHeaders['Content-Security-Policy'] as string
  const directives = parseCSP(csp)

  it('script-src allows self and Clerk JS', () => {
    const values = directives.get('script-src')!
    expect(values).toContain("'self'")
    expect(values).toContain('https://*.clerk.accounts.dev')
  })

  it('style-src allows self and Google Fonts CSS', () => {
    const values = directives.get('style-src')!
    expect(values).toContain("'self'")
    expect(values).toContain('https://fonts.googleapis.com')
  })

  it('font-src allows self and Google Fonts files', () => {
    const values = directives.get('font-src')!
    expect(values).toContain("'self'")
    expect(values).toContain('https://fonts.gstatic.com')
  })

  it('img-src allows self and Azure Blob Storage', () => {
    const values = directives.get('img-src')!
    expect(values).toContain("'self'")
    expect(values).toContain('https://*.blob.core.windows.net')
  })

  it('connect-src allows self, Clerk, backend, and Sentry', () => {
    const values = directives.get('connect-src')!
    expect(values).toContain("'self'")
    expect(values).toContain('https://*.clerk.com')
    expect(values).toContain('https://*.clerk.accounts.dev')
    expect(values).toContain('https://*.azurewebsites.net')
    expect(values).toContain('https://*.ingest.us.sentry.io')
  })

  it('frame-src allows Clerk iframes', () => {
    const values = directives.get('frame-src')!
    expect(values).toContain('https://*.clerk.com')
    expect(values).toContain('https://*.clerk.accounts.dev')
  })
})
