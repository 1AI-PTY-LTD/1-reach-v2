import { describe, it, expect } from 'vitest'
import { getBillingSummaryQueryOptions } from '../billingApi'
import { createMockApiClient } from '../../test/test-utils'

describe('billingApi', () => {
  const client = createMockApiClient()

  describe('getBillingSummaryQueryOptions', () => {
    it('returns correct query key for default page/pageSize', () => {
      const options = getBillingSummaryQueryOptions(client)
      expect(options.queryKey).toEqual(['billing', 'summary', 1, 50])
    })

    it('returns correct query key for custom page/pageSize', () => {
      const options = getBillingSummaryQueryOptions(client, 2, 25)
      expect(options.queryKey).toEqual(['billing', 'summary', 2, 25])
    })

    it('sets staleTime to 0', () => {
      const options = getBillingSummaryQueryOptions(client)
      expect(options.staleTime).toBe(0)
    })

    it('sets refetchOnMount to true', () => {
      const options = getBillingSummaryQueryOptions(client)
      expect(options.refetchOnMount).toBe(true)
    })

    it('fetches billing summary data', async () => {
      const options = getBillingSummaryQueryOptions(client)
      const result = await options.queryFn({} as never)

      expect(result).toHaveProperty('billing_mode')
      expect(result).toHaveProperty('balance')
      expect(result).toHaveProperty('monthly_limit')
      expect(result).toHaveProperty('total_monthly_spend')
      expect(result).toHaveProperty('monthly_usage_by_format')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })

    it('uses correct API URL with default pagination', async () => {
      let capturedUrl = ''
      const trackingClient = {
        get: async (url: string) => {
          capturedUrl = url
          return createMockApiClient().get(url)
        },
      } as never

      const options = getBillingSummaryQueryOptions(trackingClient)
      await options.queryFn({} as never)

      expect(capturedUrl).toBe('/api/billing/summary/?page=1&page_size=50')
    })

    it('uses correct API URL with custom pagination', async () => {
      let capturedUrl = ''
      const trackingClient = {
        get: async (url: string) => {
          capturedUrl = url
          return createMockApiClient().get(url)
        },
      } as never

      const options = getBillingSummaryQueryOptions(trackingClient, 3, 10)
      await options.queryFn({} as never)

      expect(capturedUrl).toBe('/api/billing/summary/?page=3&page_size=10')
    })
  })
})
