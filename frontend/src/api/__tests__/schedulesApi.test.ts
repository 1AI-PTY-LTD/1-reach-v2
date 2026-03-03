import { describe, it, expect } from 'vitest'
import {
  getAllSchedulesQueryOptions,
  getSchedulesByContactIdQueryOptions,
} from '../schedulesApi'
import { createMockApiClient } from '../../test/test-utils'

describe('schedulesApi', () => {
  const client = createMockApiClient()

  describe('getAllSchedulesQueryOptions', () => {
    it('returns correct query key with date and pagination', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15', 2, 25)
      expect(options.queryKey).toEqual(['schedules', '2026-01-15', 2, 25])
    })

    it('uses default page and limit', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      expect(options.queryKey).toEqual(['schedules', '2026-01-15', 1, 50])
    })

    it('fetches paginated schedules', async () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('has refetchInterval set', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      expect(options.refetchInterval).toBe(60000)
    })
  })

  describe('getSchedulesByContactIdQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getSchedulesByContactIdQueryOptions(client, 1, 2, 15)
      expect(options.queryKey).toEqual(['schedules', 'contact', 1, 2, 15])
    })

    it('uses default page and limit', () => {
      const options = getSchedulesByContactIdQueryOptions(client, 5)
      expect(options.queryKey).toEqual(['schedules', 'contact', 5, 1, 10])
    })

    it('fetches paginated schedules for contact', async () => {
      const options = getSchedulesByContactIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })
  })
})
