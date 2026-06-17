/**
 * Visual-regression PILOT (non-gating, opt-in). Catches Tailwind/layout drift
 * that functional selectors don't. Skipped unless VISUAL=1, since baselines must
 * be generated once and reviewed:
 *
 *   VISUAL=1 docker compose exec frontend npx playwright test visual.spec.ts --update-snapshots   # generate baselines
 *   VISUAL=1 docker compose exec frontend npx playwright test visual.spec.ts                       # compare
 *
 * Uses the unauthenticated landing page (no Clerk needed) as the pilot surface.
 */
import { test, expect } from '@playwright/test'

test.skip(!process.env.VISUAL, 'visual pilot — set VISUAL=1 to run')

test('landing page matches visual baseline', async ({ page }) => {
  await page.goto('/')
  await page.waitForLoadState('networkidle').catch(() => {})
  // Mask anything time/animation-sensitive if it appears; full-page baseline.
  await expect(page).toHaveScreenshot('landing.png', {
    fullPage: true,
    maxDiffPixelRatio: 0.01,
    animations: 'disabled',
  })
})
