import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { getBillingSummaryQueryOptions, getBillingTransactionsInfiniteOptions, getInvoicesQueryOptions, getInvoicePreviewQueryOptions } from '../billingApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

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

  describe('getBillingTransactionsInfiniteOptions', () => {
    it('returns correct query key', () => {
      const options = getBillingTransactionsInfiniteOptions(client, 50)
      expect(options.queryKey).toEqual(['billing', 'summary', 'infinite', 50])
    })

    it('uses default pageSize of 50', () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      expect(options.queryKey).toEqual(['billing', 'summary', 'infinite', 50])
    })

    it('has initialPageParam of 1', () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      expect(options.initialPageParam).toBe(1)
    })

    it('getNextPageParam returns next page when hasNext is true', () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      const result = options.getNextPageParam!({
        billing_mode: 'trial', balance: '10.00', monthly_limit: null,
        total_monthly_spend: '0.00', monthly_usage_by_format: {}, results: [],
        pagination: { total: 100, page: 1, limit: 50, totalPages: 2, hasNext: true, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBe(2)
    })

    it('getNextPageParam returns undefined when hasNext is false', () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      const result = options.getNextPageParam!({
        billing_mode: 'trial', balance: '10.00', monthly_limit: null,
        total_monthly_spend: '0.00', monthly_usage_by_format: {}, results: [],
        pagination: { total: 5, page: 1, limit: 50, totalPages: 1, hasNext: false, hasPrev: false },
      } as any, [] as any, 1, [] as any)
      expect(result).toBeUndefined()
    })

    it('fetches billing summary data with pageParam', async () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      const result = await options.queryFn!({ pageParam: 1, meta: undefined, signal: new AbortController().signal, direction: 'forward', queryKey: options.queryKey })
      expect(result).toHaveProperty('billing_mode')
      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
    })

    it('sets staleTime to 0', () => {
      const options = getBillingTransactionsInfiniteOptions(client)
      expect(options.staleTime).toBe(0)
    })
  })

  describe('getInvoicesQueryOptions', () => {
    it('returns correct query key for default page/pageSize', () => {
      const options = getInvoicesQueryOptions(client)
      expect(options.queryKey).toEqual(['billing', 'invoices', 1, 10])
    })

    it('returns correct query key for custom page/pageSize', () => {
      const options = getInvoicesQueryOptions(client, 2, 5)
      expect(options.queryKey).toEqual(['billing', 'invoices', 2, 5])
    })

    it('fetches invoice list data', async () => {
      const options = getInvoicesQueryOptions(client)
      const result = await options.queryFn({} as never)

      expect(result).toHaveProperty('results')
      expect(result).toHaveProperty('pagination')
      expect(result.results[0]).toHaveProperty('provider_invoice_id')
      expect(result.results[0]).toHaveProperty('status')
      expect(result.results[0]).toHaveProperty('amount')
    })
  })

  describe('getInvoicePreviewQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getInvoicePreviewQueryOptions(client)
      expect(options.queryKey).toEqual(['billing', 'invoice-preview'])
    })

    it('sets staleTime to 30 seconds', () => {
      const options = getInvoicePreviewQueryOptions(client)
      expect(options.staleTime).toBe(30_000)
    })

    it('fetches invoice preview data', async () => {
      const options = getInvoicePreviewQueryOptions(client)
      const result = await options.queryFn({} as never)

      expect(result).toHaveProperty('total')
      expect(result).toHaveProperty('period_start')
      expect(result).toHaveProperty('period_end')
      expect(result).toHaveProperty('line_items')
      expect(result.line_items[0]).toHaveProperty('format')
      expect(result.line_items[0]).toHaveProperty('quantity')
    })
  })

  describe('error handling', () => {
    it('getBillingSummaryQueryOptions rejects when API returns 403', async () => {
      server.use(
        http.get('http://localhost:8000/api/billing/summary/', () =>
          HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
        )
      )
      const options = getBillingSummaryQueryOptions(client)
      await expect(options.queryFn({} as never)).rejects.toThrow()
    })

    it('getInvoicesQueryOptions rejects when API returns 403', async () => {
      server.use(
        http.get('http://localhost:8000/api/billing/invoices/', () =>
          HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
        )
      )
      const options = getInvoicesQueryOptions(client)
      await expect(options.queryFn({} as never)).rejects.toThrow()
    })

    it('getInvoicePreviewQueryOptions rejects when API returns 403', async () => {
      server.use(
        http.get('http://localhost:8000/api/billing/invoice-preview/', () =>
          HttpResponse.json({ detail: 'Forbidden' }, { status: 403 })
        )
      )
      const options = getInvoicePreviewQueryOptions(client)
      await expect(options.queryFn({} as never)).rejects.toThrow()
    })
  })
})
