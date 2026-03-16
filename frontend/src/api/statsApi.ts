import { queryOptions } from '@tanstack/react-query'
import type { SummaryData } from '../types/stats.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

export function getSummaryQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['summary'],
    queryFn: async (): Promise<SummaryData> => {
      Logger.debug('Fetching monthly stats summary', { component: 'statsApi.getSummary' })
      const data = await client.get<SummaryData>('/api/stats/monthly/')
      Logger.debug('Successfully fetched monthly stats', {
        component: 'statsApi.getSummary',
        data: { monthCount: data.monthly_stats.length },
      })
      return data
    },
    staleTime: 0,
    refetchOnMount: true,
  })
}
