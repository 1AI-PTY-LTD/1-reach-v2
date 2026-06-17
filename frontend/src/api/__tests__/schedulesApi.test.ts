import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import {
  getAllSchedulesQueryOptions,
  getSchedulesByContactIdQueryOptions,
  getAllSchedulesInfiniteOptions,
  getSchedulesByContactIdInfiniteOptions,
  getScheduleRecipientsQueryOptions,
  useCreateScheduleMutation,
  useCancelScheduleMutation,
  useRetryScheduleMutation,
  useUpdateScheduleMutation,
} from '../schedulesApi'
import { createMockApiClient, createWrapper } from '../../test/test-utils'
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

    it('has dynamic refetchInterval', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      expect(typeof options.refetchInterval).toBe('function')
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

    it('has dynamic refetchInterval', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      expect(typeof options.refetchInterval).toBe('function')
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

  describe('dynamic refetchInterval', () => {
    it('returns 2000ms when schedules have transient statuses', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: {
            results: [
              { status: 'queued' },
              { status: 'delivered' },
            ],
            pagination: { total: 2, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
          },
        },
      }
      expect(refetchInterval(query)).toBe(2000)
    })

    it('returns 60000ms when all schedules are terminal', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: {
            results: [
              { status: 'delivered' },
              { status: 'failed' },
            ],
            pagination: { total: 2, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
          },
        },
      }
      expect(refetchInterval(query)).toBe(60000)
    })

    it('returns 5000ms when a message is sent (awaiting delivery receipt)', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: {
            results: [
              { status: 'delivered' },
              { status: 'sent' },
            ],
            pagination: { total: 2, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
          },
        },
      }
      expect(refetchInterval(query)).toBe(5000)
    })

    it('returns 60000ms when data is not yet loaded', () => {
      const options = getAllSchedulesQueryOptions(client, '2026-01-15')
      const refetchInterval = options.refetchInterval as Function
      expect(refetchInterval({ state: { data: undefined } })).toBe(60000)
    })

    it('infinite query returns 2000ms for transient schedules', () => {
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: {
            pages: [
              { results: [{ status: 'sent' }], pagination: {} },
              { results: [{ status: 'processing' }], pagination: {} },
            ],
          },
        },
      }
      expect(refetchInterval(query)).toBe(2000)
    })

    it('recipients query returns false when all terminal', () => {
      const options = getScheduleRecipientsQueryOptions(client, 1)
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: [
            { status: 'delivered' },
            { status: 'failed' },
          ],
        },
      }
      expect(refetchInterval(query)).toBe(false)
    })

    it('recipients query returns 2000ms when transient', () => {
      const options = getScheduleRecipientsQueryOptions(client, 1)
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: [
            { status: 'delivered' },
            { status: 'retrying' },
          ],
        },
      }
      expect(refetchInterval(query)).toBe(2000)
    })

    it('recipients query returns 5000ms when a message is sent', () => {
      const options = getScheduleRecipientsQueryOptions(client, 1)
      const refetchInterval = options.refetchInterval as Function
      const query = {
        state: {
          data: [
            { status: 'delivered' },
            { status: 'sent' },
          ],
        },
      }
      expect(refetchInterval(query)).toBe(5000)
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

    it('retrySchedule rejects when API returns 402', async () => {
      server.use(
        http.post('http://localhost:8000/api/schedules/:id/retry/', () =>
          HttpResponse.json({ detail: 'Insufficient credits' }, { status: 402 })
        )
      )
      await expect(client.post('/api/schedules/1/retry/')).rejects.toThrow()
    })

    it('cancelSchedule rejects when API returns 400', async () => {
      server.use(
        http.delete('http://localhost:8000/api/schedules/:id/', () =>
          HttpResponse.json({ detail: 'Cannot delete schedule' }, { status: 400 })
        )
      )
      await expect(client.del('/api/schedules/1/')).rejects.toThrow()
    })

    it('getAllSchedulesInfiniteOptions queryFn rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/schedules/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllSchedulesInfiniteOptions(client, '2026-01-15')
      await expect(options.queryFn!({ pageParam: 1 } as any)).rejects.toThrow()
    })

    it('getSchedulesByContactIdInfiniteOptions queryFn rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/contacts/:contactId/schedules/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getSchedulesByContactIdInfiniteOptions(client, 1)
      await expect(options.queryFn!({ pageParam: 1 } as any)).rejects.toThrow()
    })

    it('getScheduleRecipientsQueryOptions queryFn rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/schedules/:id/recipients/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getScheduleRecipientsQueryOptions(client, 1)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })
  })

  describe('getScheduleRecipientsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getScheduleRecipientsQueryOptions(client, 42)
      expect(options.queryKey).toEqual(['schedules', 42, 'recipients'])
    })

    it('is enabled when scheduleId is truthy', () => {
      const options = getScheduleRecipientsQueryOptions(client, 42)
      expect(options.enabled).toBe(true)
    })

    it('is disabled when scheduleId is 0', () => {
      const options = getScheduleRecipientsQueryOptions(client, 0)
      expect(options.enabled).toBe(false)
    })

    it('fetches the list of recipient schedules', async () => {
      const options = getScheduleRecipientsQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('id')
      expect(result[0]).toHaveProperty('status')
    })

    it('refetchInterval returns false when data is not yet loaded', () => {
      const options = getScheduleRecipientsQueryOptions(client, 1)
      const refetchInterval = options.refetchInterval as Function
      expect(refetchInterval({ state: { data: undefined } })).toBe(false)
    })
  })

  describe('useCreateScheduleMutation', () => {
    const validVars = {
      text: 'Hello there',
      phone: '0412111111',
      contact_id: 1,
      scheduled_time: '2026-12-01T10:00:00Z',
    }

    it('succeeds and returns the created schedule', async () => {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(validVars)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toHaveProperty('id')
    })

    it('sets isError when the API returns 402', async () => {
      server.use(
        http.post('http://localhost:8000/api/schedules/', () =>
          HttpResponse.json({ detail: 'Insufficient credits' }, { status: 402 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(validVars)
      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useCancelScheduleMutation', () => {
    it('succeeds when the API returns 204', async () => {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCancelScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(1)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })

    it('sets isError when the API returns 400', async () => {
      server.use(
        http.delete('http://localhost:8000/api/schedules/:id/', () =>
          HttpResponse.json({ detail: 'Cannot cancel schedule' }, { status: 400 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCancelScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(1)
      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useRetryScheduleMutation', () => {
    it('succeeds and returns the requeued schedule', async () => {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useRetryScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(1)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toHaveProperty('status', 'queued')
    })

    it('sets isError when the API returns 402', async () => {
      server.use(
        http.post('http://localhost:8000/api/schedules/:id/retry/', () =>
          HttpResponse.json({ detail: 'Insufficient credits' }, { status: 402 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useRetryScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(1)
      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useUpdateScheduleMutation', () => {
    const validVars = {
      id: 1,
      contact_id: 1,
      text: 'Updated text',
      scheduled_time: '2026-12-01T10:00:00Z',
    }

    it('succeeds and returns the updated schedule', async () => {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useUpdateScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate(validVars)
      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toHaveProperty('id', 1)
    })

    it('sets isError when the API returns 404', async () => {
      server.use(
        http.put('http://localhost:8000/api/schedules/:id/', () =>
          HttpResponse.json({ detail: 'Schedule not found' }, { status: 404 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useUpdateScheduleMutation(client), { wrapper: Wrapper })
      result.current.mutate({ ...validVars, id: 9999 })
      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })
})
