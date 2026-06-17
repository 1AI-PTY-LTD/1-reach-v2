/**
 * Worker liveness gate. `/api/health/worker/` reports the Celery dispatch
 * heartbeat (written to Redis each beat tick by the worker). If the worker or
 * beat is down — or running the wrong process (the gunicorn-instead-of-celery
 * incident) — this fails fast with a clear cause, instead of the real-pipeline
 * specs timing out ambiguously.
 *
 * Public endpoint (AllowAny) — no auth needed. Polls to allow for the first
 * beat tick after the stack starts.
 */
import { test, expect } from '@playwright/test'

const API_BASE = process.env.E2E_API_BASE_URL || 'http://localhost:8000'

test('celery worker + beat are processing (dispatch heartbeat is fresh)', async ({ request }) => {
  await expect(async () => {
    const res = await request.get(`${API_BASE}/api/health/worker/`)
    expect(res.status(), 'worker health should be 200 — is celery_worker/celery_beat running?').toBe(200)
    const body = await res.json()
    expect(body.status).toBe('ok')
    expect(body.checks.broker).toBe('ok')
    expect(body.checks.heartbeat, `heartbeat not fresh: ${JSON.stringify(body.checks)}`).toBe('ok')
  }).toPass({ timeout: 90_000, intervals: [2000] })
})
