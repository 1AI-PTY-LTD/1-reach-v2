import { describe, it, expect } from 'vitest'
import { getSummaryQueryOptions } from '../statsApi'
import { createMockApiClient } from '../../test/test-utils'

describe('statsApi', () => {
  const client = createMockApiClient()

  describe('getSummaryQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getSummaryQueryOptions(client)
      expect(options.queryKey).toEqual(['summary'])
    })

    it('has staleTime of 0', () => {
      const options = getSummaryQueryOptions(client)
      expect(options.staleTime).toBe(0)
    })

    it('has refetchOnMount enabled', () => {
      const options = getSummaryQueryOptions(client)
      expect(options.refetchOnMount).toBe(true)
    })

    it('fetches summary data with monthly stats', async () => {
      const options = getSummaryQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('monthly_stats')
      expect(result).toHaveProperty('sms_limit')
      expect(result).toHaveProperty('mms_limit')
      expect(Array.isArray(result.monthly_stats)).toBe(true)
      expect(result.monthly_stats.length).toBeGreaterThan(0)
      expect(result.monthly_stats[0]).toHaveProperty('month')
      expect(result.monthly_stats[0]).toHaveProperty('sms_sent')
    })
  })
})
