import { describe, it, expect } from 'vitest'
import {
  getAllGroupSchedulesQueryOptions,
  getGroupScheduleByIdQueryOptions,
} from '../groupSchedulesApi'
import { createMockApiClient } from '../../test/test-utils'

describe('groupSchedulesApi', () => {
  const client = createMockApiClient()

  describe('getAllGroupSchedulesQueryOptions', () => {
    it('returns correct query key with all params', () => {
      const options = getAllGroupSchedulesQueryOptions(client, '2026-01-15', 1, 2, 10)
      expect(options.queryKey).toEqual(['group-schedules', '2026-01-15', 1, 2, 10])
    })

    it('uses "all" for undefined date and groupId', () => {
      const options = getAllGroupSchedulesQueryOptions(client)
      expect(options.queryKey).toEqual(['group-schedules', 'all', 'all', 1, 10])
    })

    it('fetches paginated group schedules', async () => {
      const options = getAllGroupSchedulesQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
      expect(Array.isArray(result.results)).toBe(true)
    })

    it('has refetchInterval set', () => {
      const options = getAllGroupSchedulesQueryOptions(client)
      expect(options.refetchInterval).toBe(60 * 1000)
    })
  })

  describe('getGroupScheduleByIdQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getGroupScheduleByIdQueryOptions(client, 1)
      expect(options.queryKey).toEqual(['group-schedules', 1])
    })

    it('fetches group schedule by ID', async () => {
      const options = getGroupScheduleByIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('id', 1)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('child_count')
    })
  })
})
