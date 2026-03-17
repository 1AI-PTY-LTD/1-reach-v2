import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  getAllSchedulesQueryOptions,
  getSchedulesByContactIdQueryOptions,
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
  })
})
