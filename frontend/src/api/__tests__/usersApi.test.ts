import { describe, it, expect } from 'vitest'
import { http, HttpResponse } from 'msw'
import { getAllUsersQueryOptions } from '../usersApi'
import { createMockApiClient } from '../../test/test-utils'
import { server } from '../../test/handlers'

describe('usersApi', () => {
  const client = createMockApiClient()

  describe('getAllUsersQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllUsersQueryOptions(client)
      expect(options.queryKey).toEqual(['users'])
    })

    it('has a queryFn', () => {
      const options = getAllUsersQueryOptions(client)
      expect(options.queryFn).toBeDefined()
    })

    it('fetches users from API', async () => {
      const options = getAllUsersQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('first_name')
      expect(result[0]).toHaveProperty('email')
      expect(result[0]).toHaveProperty('role')
      expect(result[0]).toHaveProperty('organisation')
      expect(result[0]).toHaveProperty('is_active')
    })

    it('returns users with expected structure', async () => {
      const options = getAllUsersQueryOptions(client)
      const result = await options.queryFn!({} as any)
      const admin = result.find((u: any) => u.role === 'org:admin')
      expect(admin).toBeDefined()
      expect(admin).toHaveProperty('clerk_id')
    })
  })

  describe('error handling', () => {
    it('getAllUsersQueryOptions rejects when API returns 500', async () => {
      server.use(
        http.get('http://localhost:8000/api/users/', () =>
          HttpResponse.json({ detail: 'Internal Server Error' }, { status: 500 })
        )
      )
      const options = getAllUsersQueryOptions(client)
      await expect(options.queryFn!({} as any)).rejects.toThrow()
    })
  })
})
