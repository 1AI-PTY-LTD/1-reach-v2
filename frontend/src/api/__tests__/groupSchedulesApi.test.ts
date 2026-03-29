import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  getAllGroupSchedulesQueryOptions,
  getGroupScheduleByIdQueryOptions,
  getGroupSchedulesInfiniteOptions,
} from '../groupSchedulesApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

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

  describe('getGroupSchedulesInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1, 20)
      expect(options.queryKey).toEqual(['group-schedules', 'group', 1, 'infinite', 20])
    })

    it('uses default limit of 20', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 5)
      expect(options.queryKey).toEqual(['group-schedules', 'group', 5, 'infinite', 20])
    })

    it('has initialPageParam of 1', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1)
      expect(options.initialPageParam).toBe(1)
    })

    it('getNextPageParam returns next page when hasNext is true', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 40, page: 1, limit: 20, totalPages: 2, hasNext: true, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBe(2)
    })

    it('getNextPageParam returns undefined when hasNext is false', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 5, page: 1, limit: 20, totalPages: 1, hasNext: false, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('fetches paginated data with pageParam', async () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1)
      const result = await options.queryFn!({ pageParam: 1, meta: undefined, signal: new AbortController().signal, direction: 'forward', queryKey: options.queryKey })
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })

    it('has refetchInterval set', () => {
      const options = getGroupSchedulesInfiniteOptions(client, 1)
      expect(options.refetchInterval).toBe(60 * 1000)
    })
  })

  describe('error handling', () => {
    it('getAllGroupSchedulesQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/group-schedules/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllGroupSchedulesQueryOptions(client)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })
  })
})
