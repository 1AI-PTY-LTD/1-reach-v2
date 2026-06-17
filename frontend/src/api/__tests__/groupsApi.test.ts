import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import {
  getAllGroupsQueryOptions,
  getGroupByIdQueryOptions,
  getGroupMembersInfiniteOptions,
  getSearchInGroupsQueryOptions,
  useCreateGroupMutation,
  useUpdateGroupMutation,
  useDeleteGroupMutation,
  useAddMembersToGroupMutation,
  useRemoveMembersFromGroupMutation,
} from '../groupsApi'
import { createMockApiClient, createWrapper } from '../../test/test-utils'
import { server } from '../../test/handlers'

const BASE_URL = 'http://localhost:8000'

describe('groupsApi', () => {
  const client = createMockApiClient()

  describe('getAllGroupsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllGroupsQueryOptions(client)
      expect(options.queryKey).toEqual(['groups'])
    })

    it('has staleTime set', () => {
      const options = getAllGroupsQueryOptions(client)
      expect(options.staleTime).toBe(5 * 60 * 1000) // 5 minutes
    })

    it('fetches groups from API', async () => {
      const options = getAllGroupsQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('member_count')
    })
  })

  describe('getGroupByIdQueryOptions', () => {
    it('returns correct query key with pagination', () => {
      const options = getGroupByIdQueryOptions(client, 1, 2, 20)
      expect(options.queryKey).toEqual(['groups', 1, 2, 20])
    })

    it('uses default page and limit', () => {
      const options = getGroupByIdQueryOptions(client, 5)
      expect(options.queryKey).toEqual(['groups', 5, 1, 10])
    })

    it('fetches group with members', async () => {
      const options = getGroupByIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })
  })

  describe('getGroupMembersInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getGroupMembersInfiniteOptions(client, 1, 10)
      expect(options.queryKey).toEqual(['groups', 1, 'members', 'infinite', 10])
    })

    it('uses default limit of 10', () => {
      const options = getGroupMembersInfiniteOptions(client, 5)
      expect(options.queryKey).toEqual(['groups', 5, 'members', 'infinite', 10])
    })

    it('has initialPageParam of 1', () => {
      const options = getGroupMembersInfiniteOptions(client, 1)
      expect(options.initialPageParam).toBe(1)
    })

    it('getNextPageParam returns next page when pagination.hasNext is true', () => {
      const options = getGroupMembersInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        id: 1, name: 'Test', member_count: 20, members: [],
        pagination: { total: 20, page: 1, limit: 10, totalPages: 2, hasNext: true, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBe(2)
    })

    it('getNextPageParam returns undefined when pagination.hasNext is false', () => {
      const options = getGroupMembersInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        id: 1, name: 'Test', member_count: 5, members: [],
        pagination: { total: 5, page: 1, limit: 10, totalPages: 1, hasNext: false, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('getNextPageParam returns undefined when pagination is missing', () => {
      const options = getGroupMembersInfiniteOptions(client, 1)
      const result = options.getNextPageParam!({
        id: 1, name: 'Test', member_count: 3, members: [],
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('fetches group detail with members', async () => {
      const options = getGroupMembersInfiniteOptions(client, 1)
      const result = await options.queryFn!({ pageParam: 1, meta: undefined, signal: new AbortController().signal, direction: 'forward', queryKey: options.queryKey })
      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })
  })

  describe('getSearchInGroupsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getSearchInGroupsQueryOptions(client, 'VIP')
      expect(options.queryKey).toEqual(['groups', 'search', 'VIP'])
    })

    it('is disabled when search string is less than 2 chars', () => {
      const options = getSearchInGroupsQueryOptions(client, 'V')
      expect(options.enabled).toBe(false)
    })

    it('is enabled when search string is 2+ chars', () => {
      const options = getSearchInGroupsQueryOptions(client, 'VI')
      expect(options.enabled).toBe(true)
    })

    it('fetches filtered groups', async () => {
      const options = getSearchInGroupsQueryOptions(client, 'VIP')
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.some((g: any) => g.name.includes('VIP'))).toBe(true)
    })
  })

  describe('error handling', () => {
    it('getAllGroupsQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/groups/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllGroupsQueryOptions(client)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })

    it('getGroupByIdQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get(`${BASE_URL}/api/groups/:id/`, () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getGroupByIdQueryOptions(client, 1)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })

    it('getGroupMembersInfiniteOptions rejects when API returns 500', async () => {
      server.use(
        http.get(`${BASE_URL}/api/groups/:id/`, () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getGroupMembersInfiniteOptions(client, 1)
      await expect(options.queryFn!({ pageParam: 1 } as any)).rejects.toThrow()
    })

    it('getSearchInGroupsQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get(`${BASE_URL}/api/groups/`, () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getSearchInGroupsQueryOptions(client, 'VIP')
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })
  })

  describe('useCreateGroupMutation', () => {
    it('creates a group successfully', async () => {
      server.use(
        http.post(`${BASE_URL}/api/groups/`, async ({ request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json(
            {
              id: 100,
              name: body.name,
              description: body.description ?? null,
              is_active: true,
              member_count: 0,
              created_at: '2026-01-01T00:00:00Z',
              updated_at: '2026-01-01T00:00:00Z',
            },
            { status: 201 }
          )
        })
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ name: 'Brand New Group', description: 'desc' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toMatchObject({ id: 100, name: 'Brand New Group' })
    })

    it('surfaces an error when the API returns 400', async () => {
      server.use(
        http.post(`${BASE_URL}/api/groups/`, () =>
          HttpResponse.json({ detail: 'name is required' }, { status: 400 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useCreateGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ name: '' })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useUpdateGroupMutation', () => {
    it('updates a group successfully', async () => {
      server.use(
        http.put(`${BASE_URL}/api/groups/:id/`, async ({ params, request }) => {
          const body = (await request.json()) as Record<string, unknown>
          return HttpResponse.json({
            id: Number(params.id),
            name: 'Existing',
            description: null,
            is_active: true,
            member_count: 3,
            created_at: '2026-01-01T00:00:00Z',
            updated_at: '2026-01-01T00:00:00Z',
            ...body,
          })
        })
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useUpdateGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ id: 1, name: 'Renamed Group' })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toMatchObject({ id: 1, name: 'Renamed Group' })
    })

    it('surfaces an error when the API returns 404', async () => {
      server.use(
        http.put(`${BASE_URL}/api/groups/:id/`, () =>
          HttpResponse.json({ detail: 'Group not found' }, { status: 404 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useUpdateGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ id: 999, name: 'Nope' })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useDeleteGroupMutation', () => {
    it('deletes a group successfully', async () => {
      server.use(
        http.delete(`${BASE_URL}/api/groups/:id/`, () => new HttpResponse(null, { status: 204 }))
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useDeleteGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate(1)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
    })

    it('surfaces an error when the API returns 500', async () => {
      server.use(
        http.delete(`${BASE_URL}/api/groups/:id/`, () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useDeleteGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate(1)

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useAddMembersToGroupMutation', () => {
    it('adds members successfully', async () => {
      server.use(
        http.post(`${BASE_URL}/api/groups/:id/members/`, () =>
          HttpResponse.json({ message: 'Members added', added_count: 2 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useAddMembersToGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ group_id: 1, contact_ids: [1, 2] })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toMatchObject({ added_count: 2 })
    })

    it('surfaces an error when the API returns 400', async () => {
      server.use(
        http.post(`${BASE_URL}/api/groups/:id/members/`, () =>
          HttpResponse.json({ detail: 'Invalid contact ids' }, { status: 400 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useAddMembersToGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ group_id: 1, contact_ids: [999] })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })

  describe('useRemoveMembersFromGroupMutation', () => {
    it('removes members successfully', async () => {
      server.use(
        http.delete(`${BASE_URL}/api/groups/:id/members/`, () =>
          HttpResponse.json({ message: 'Members removed', removed_count: 1 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useRemoveMembersFromGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ group_id: 1, contact_ids: [1] })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(result.current.data).toMatchObject({ removed_count: 1 })
    })

    it('surfaces an error when the API returns 500', async () => {
      server.use(
        http.delete(`${BASE_URL}/api/groups/:id/members/`, () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useRemoveMembersFromGroupMutation(client), { wrapper: Wrapper })

      result.current.mutate({ group_id: 1, contact_ids: [1] })

      await waitFor(() => expect(result.current.isError).toBe(true))
    })
  })
})
