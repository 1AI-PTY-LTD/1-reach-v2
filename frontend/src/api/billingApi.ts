import { queryOptions, infiniteQueryOptions } from '@tanstack/react-query'
import type { BillingSummaryResponse } from '../types/billing.types'
import type { ApiClient } from '../lib/helper'

export function getBillingSummaryQueryOptions(client: ApiClient, page = 1, pageSize = 50) {
  return queryOptions({
    queryKey: ['billing', 'summary', page, pageSize],
    queryFn: (): Promise<BillingSummaryResponse> =>
      client.get<BillingSummaryResponse>(
        `/api/billing/summary/?page=${page}&page_size=${pageSize}`,
      ),
    staleTime: 0,
    refetchOnMount: true,
  })
}

export function getBillingTransactionsInfiniteOptions(client: ApiClient, pageSize: number = 50) {
  return infiniteQueryOptions({
    queryKey: ['billing', 'summary', 'infinite', pageSize],
    queryFn: async ({ pageParam }): Promise<BillingSummaryResponse> =>
      client.get<BillingSummaryResponse>(
        `/api/billing/summary/?page=${pageParam}&page_size=${pageSize}`,
      ),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasNext ? lastPage.pagination.page + 1 : undefined,
    staleTime: 0,
    refetchOnMount: true,
  })
}
