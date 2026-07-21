import { queryOptions, infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Conversation, ThreadResponse, UnreadCountResponse } from '../types/conversation.types'
import { threadPollInterval } from '../types/conversation.types'
import type { PaginatedResponse } from '../types/pagination.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

export type PaginatedConversations = PaginatedResponse<Conversation>

// Replies arrive server-side via provider webhook; the frontend learns of
// them purely by polling, so the list and badge refetch on a steady cadence.
const CONVERSATION_POLL_MS = 20000

export function getConversationsQueryOptions(client: ApiClient, page: number = 1, limit: number = 50) {
  return queryOptions({
    queryKey: ['conversations', 'list', page, limit],
    queryFn: async (): Promise<PaginatedConversations> => {
      Logger.debug('Fetching conversations', {
        component: 'conversationsApi.getConversations',
        data: { page, limit },
      })
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedConversations>(`/api/conversations/?${params.toString()}`)
      Logger.debug('Successfully fetched conversations', {
        component: 'conversationsApi.getConversations',
        data: { count: data.results.length, total: data.pagination.total },
      })
      return data
    },
    refetchInterval: CONVERSATION_POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
}

export function getUnreadCountQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['conversations', 'unread-count'],
    queryFn: async (): Promise<UnreadCountResponse> => {
      const data = await client.get<UnreadCountResponse>('/api/conversations/unread-count/')
      Logger.debug('Fetched unread count', {
        component: 'conversationsApi.getUnreadCount',
        data,
      })
      return data
    },
    refetchInterval: CONVERSATION_POLL_MS,
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

export function getThreadInfiniteOptions(client: ApiClient, contactId: number, limit: number = 50) {
  return infiniteQueryOptions({
    queryKey: ['thread', contactId, limit],
    queryFn: async ({ pageParam }): Promise<ThreadResponse> => {
      Logger.debug('Fetching conversation thread', {
        component: 'conversationsApi.getThread',
        data: { contactId, before: pageParam, limit },
      })
      const params = new URLSearchParams()
      params.append('limit', limit.toString())
      if (pageParam) {
        params.append('before', pageParam)
      }
      return client.get<ThreadResponse>(
        `/api/conversations/${contactId}/thread/?${params.toString()}`
      )
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) =>
      lastPage.has_more ? lastPage.next_before : undefined,
    refetchInterval: (query) => {
      const pages = query.state.data?.pages
      return pages ? threadPollInterval(pages.flatMap((p) => p.results)) : 15000
    },
    refetchIntervalInBackground: true,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
}

export function useMarkReadMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (contactId: number) => {
      Logger.debug('Marking conversation read', {
        component: 'conversationsApi.markRead',
        data: { contactId },
      })
      return client.post<{ marked: number }>(`/api/conversations/${contactId}/mark-read/`)
    },
    onSuccess: (data, contactId) => {
      Logger.info('Conversation marked read', {
        component: 'conversationsApi.markRead',
        data: { contactId, marked: data.marked },
      })
      // Prefix match covers both the list and the unread-count badge.
      queryClient.invalidateQueries({ queryKey: ['conversations'] })
      queryClient.invalidateQueries({ queryKey: ['thread', contactId] })
    },
    onError: (error) => {
      Logger.error('Error marking conversation read', {
        component: 'conversationsApi.markRead',
        data: { error: error.message },
      })
    },
  })
}
