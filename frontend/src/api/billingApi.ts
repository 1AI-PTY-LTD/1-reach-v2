import { queryOptions } from '@tanstack/react-query'
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
