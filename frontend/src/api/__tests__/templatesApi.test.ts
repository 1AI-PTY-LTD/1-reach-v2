import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import {
  getAllTemplatesQueryOptions,
  getTemplateByIdQueryOptions,
} from '../templatesApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

describe('templatesApi', () => {
  const client = createMockApiClient()

  describe('getAllTemplatesQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllTemplatesQueryOptions(client)
      expect(options.queryKey).toEqual(['templates'])
    })

    it('fetches templates from API', async () => {
      const options = getAllTemplatesQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('text')
    })
  })

  describe('getTemplateByIdQueryOptions', () => {
    it('returns correct query key with id', () => {
      const options = getTemplateByIdQueryOptions(client, 1)
      expect(options.queryKey).toEqual(['templates', 1])
    })

    it('fetches template by ID', async () => {
      const options = getTemplateByIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('id', 1)
      expect(result).toHaveProperty('name')
    })
  })

  describe('error handling', () => {
    it('getAllTemplatesQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/templates/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllTemplatesQueryOptions(client)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })
  })
})
