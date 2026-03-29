import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  getAllSchedulesQueryOptions,
  getSchedulesByContactIdQueryOptions,
  getAllSchedulesInfiniteOptions,
  getSchedulesByContactIdInfiniteOptions,
} from '../schedulesApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

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

  describe('getAllSchedulesInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15', 50)
      expect(options.queryKey).toEqual(['schedules', '2026-01-15', 'infinite', 50])
    })

    it('uses default limit of 50', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      expect(options.queryKey).toEqual(['schedules', '2026-01-15', 'infinite', 50])
    })

    it('has initialPageParam of 1', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      expect(options.initialPageParam).toBe(1)
    })

    it('getNextPageParam returns next page when hasNext is true', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 100, page: 1, limit: 50, totalPages: 2, hasNext: true, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBe(2)
    })

    it('getNextPageParam returns undefined when hasNext is false', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 50, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('fetches paginated data with pageParam', async () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      const result = await options.queryFn!({ pageParam: 1, meta: undefined, signal: new AbortController().signal, direction: 'forward', queryKey: options.queryKey })
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })

    it('has refetchInterval set', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      expect(options.refetchInterval).toBe(60000)
    })
  })

  describe('getSchedulesByContactIdInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 1, 50)
      expect(options.queryKey).toEqual(['schedules', 'contact', 1, 'infinite', 50])
    })

    it('uses default limit of 50', () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 5)
      expect(options.queryKey).toEqual(['schedules', 'contact', 5, 'infinite', 50])
    })

    it('has initialPageParam of 1', () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 1)
      expect(options.initialPageParam).toBe(1)
    })

    it('getNextPageParam returns next page when hasNext is true', () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 100, page: 2, limit: 50, totalPages: 3, hasNext: true, hasPrev: true },
      } as any, [] as any, 2, [] as any)
      expect(result).toBe(3)
    })

    it('getNextPageParam returns undefined when hasNext is false', () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        results: [],
        pagination: { total: 10, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('fetches paginated data with pageParam', async () => {
      const options = getSchedulesByContactIdInfiniteOptions(client, 1)
      const result = await options.queryFn!({ pageParam: 1, meta: undefined, signal: new AbortController().signal, direction: 'forward', queryKey: options.queryKey })
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })
  })

  describe('error handling', () => {
    it('getAllSchedulesQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/schedules/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })

    it('getSchedulesByContactIdQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/contacts/:contactId/schedules/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getSchedulesByContactIdQueryOptions(client, 1)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })

    it('cancelSchedule rejects when API returns 400', async () => {
      server.use(
        http.delete('http://localhost:8000/api/schedules/:id/', () =>
          HttpResponse.json({ detail: 'Cannot delete schedule' }, { status: 400 })
        )
      )
      await expect(client.del('/api/schedules/1/')).rejects.toThrow()
    })
  })
})
