import { describe, it, expect } from 'vitest'
import { TRANSIENT_STATUSES, hasTransientSchedule } from '../schedule.types'
import type { ScheduleStatus } from '../schedule.types'

describe('schedule status helpers', () => {
  describe('TRANSIENT_STATUSES', () => {
    it('contains the four transient statuses', () => {
      expect(TRANSIENT_STATUSES.has('pending')).toBe(true)
      expect(TRANSIENT_STATUSES.has('queued')).toBe(true)
      expect(TRANSIENT_STATUSES.has('processing')).toBe(true)
      expect(TRANSIENT_STATUSES.has('retrying')).toBe(true)
    })

    it('does not contain terminal statuses', () => {
      expect(TRANSIENT_STATUSES.has('sent')).toBe(false)
      expect(TRANSIENT_STATUSES.has('delivered')).toBe(false)
      expect(TRANSIENT_STATUSES.has('failed')).toBe(false)
      expect(TRANSIENT_STATUSES.has('cancelled')).toBe(false)
    })
  })

  describe('hasTransientSchedule', () => {
    it('returns true when any schedule is transient', () => {
      const schedules = [
        { status: 'delivered' as ScheduleStatus },
        { status: 'processing' as ScheduleStatus },
        { status: 'failed' as ScheduleStatus },
      ]
      expect(hasTransientSchedule(schedules)).toBe(true)
    })

    it('returns false when all schedules are terminal', () => {
      const schedules = [
        { status: 'delivered' as ScheduleStatus },
        { status: 'failed' as ScheduleStatus },
        { status: 'cancelled' as ScheduleStatus },
        { status: 'sent' as ScheduleStatus },
      ]
      expect(hasTransientSchedule(schedules)).toBe(false)
    })

    it('returns false for empty array', () => {
      expect(hasTransientSchedule([])).toBe(false)
    })

    it('returns true for single transient schedule', () => {
      expect(hasTransientSchedule([{ status: 'queued' as ScheduleStatus }])).toBe(true)
    })
  })
})
