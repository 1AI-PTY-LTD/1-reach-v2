import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { renderHook, waitFor } from '@testing-library/react'
import {
  getConversationsQueryOptions,
  getUnreadCountQueryOptions,
  getThreadInfiniteOptions,
  useMarkReadMutation,
} from '../conversationsApi'
import { createMockApiClient, createWrapper } from '../../test/test-utils'
import { server } from '../../test/handlers'
import { createInboundThreadItem, createThreadResponse } from '../../test/factories'

const BASE_URL = 'http://localhost:8000'

describe('conversationsApi', () => {
  const client = createMockApiClient()

  describe('getConversationsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getConversationsQueryOptions(client, 2, 25)
      expect(options.queryKey).toEqual(['conversations', 'list', 2, 25])
    })

    it('uses default page and limit', () => {
      const options = getConversationsQueryOptions(client)
      expect(options.queryKey).toEqual(['conversations', 'list', 1, 50])
    })

    it('fetches paginated conversations', async () => {
      const options = getConversationsQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
      expect(result.results[0]).toHaveProperty('contact_id')
      expect(result.results[0]).toHaveProperty('unread_count')
    })

    it('polls on a steady interval', () => {
      const options = getConversationsQueryOptions(client)
      expect(options.refetchInterval).toBe(20000)
      expect(options.refetchIntervalInBackground).toBe(true)
    })
  })

  describe('getUnreadCountQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getUnreadCountQueryOptions(client)
      expect(options.queryKey).toEqual(['conversations', 'unread-count'])
    })

    it('fetches the unread count', async () => {
      const options = getUnreadCountQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(typeof result.unread).toBe('number')
    })

    it('polls on a steady interval', () => {
      const options = getUnreadCountQueryOptions(client)
      expect(options.refetchInterval).toBe(20000)
    })
  })

  describe('getThreadInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getThreadInfiniteOptions(client, 7, 25)
      expect(options.queryKey).toEqual(['thread', 7, 25])
    })

    it('starts with a null cursor', () => {
      const options = getThreadInfiniteOptions(client, 7)
      expect(options.initialPageParam).toBeNull()
    })

    it('fetches the thread envelope', async () => {
      const options = getThreadInfiniteOptions(client, 1)
      const result = await options.queryFn!({ pageParam: null } as any)
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('has_more')
      expect(result).toHaveProperty('next_before')
    })

    it('passes the before cursor as a query param', async () => {
      let capturedBefore: string | null = null
      server.use(
        http.get(`${BASE_URL}/api/conversations/:contactId/thread/`, ({ request }) => {
          capturedBefore = new URL(request.url).searchParams.get('before')
          return HttpResponse.json(createThreadResponse([]))
        })
      )

      const options = getThreadInfiniteOptions(client, 1)
      await options.queryFn!({ pageParam: '2026-07-10T00:00:00Z' } as any)

      expect(capturedBefore).toBe('2026-07-10T00:00:00Z')
    })

    it('pages via next_before while has_more', () => {
      const options = getThreadInfiniteOptions(client, 1)
      const more = createThreadResponse([createInboundThreadItem()], {
        has_more: true,
        next_before: '2026-07-10T00:00:00Z',
      })
      const done = createThreadResponse([createInboundThreadItem()])

      expect(options.getNextPageParam(more, [more], null, [])).toBe('2026-07-10T00:00:00Z')
      expect(options.getNextPageParam(done, [done], null, [])).toBeUndefined()
    })

    it('has dynamic refetchInterval', () => {
      const options = getThreadInfiniteOptions(client, 1)
      expect(typeof options.refetchInterval).toBe('function')
    })
  })

  describe('useMarkReadMutation', () => {
    it('posts mark-read and resolves with the marked count', async () => {
      const { Wrapper } = createWrapper()
      const { result } = renderHook(() => useMarkReadMutation(client), {
        wrapper: Wrapper,
      })

      const response = await result.current.mutateAsync(1)

      await waitFor(() => expect(result.current.isSuccess).toBe(true))
      expect(response).toHaveProperty('marked')
    })
  })
})
