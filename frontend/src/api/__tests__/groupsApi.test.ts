import { describe, it, expect } from 'vitest'
import {
  getAllGroupsQueryOptions,
  getGroupByIdQueryOptions,
  getSearchInGroupsQueryOptions,
} from '../groupsApi'
import { createMockApiClient } from '../../test/test-utils'

describe('groupsApi', () => {
  const client = createMockApiClient()

  describe('getAllGroupsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllGroupsQueryOptions(client)
      expect(options.queryKey).toEqual(['groups'])
    })

    it('has staleTime set', () => {
      const options = getAllGroupsQueryOptions(client)
      expect(options.staleTime).toBe(5 * 60 * 1000) // 5 minutes
    })

    it('fetches groups from API', async () => {
      const options = getAllGroupsQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('name')
      expect(result[0]).toHaveProperty('member_count')
    })
  })

  describe('getGroupByIdQueryOptions', () => {
    it('returns correct query key with pagination', () => {
      const options = getGroupByIdQueryOptions(client, 1, 2, 20)
      expect(options.queryKey).toEqual(['groups', 1, 2, 20])
    })

    it('uses default page and limit', () => {
      const options = getGroupByIdQueryOptions(client, 5)
      expect(options.queryKey).toEqual(['groups', 5, 1, 10])
    })

    it('fetches group with members', async () => {
      const options = getGroupByIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('name')
      expect(result).toHaveProperty('members')
      expect(Array.isArray(result.members)).toBe(true)
    })
  })

  describe('getSearchInGroupsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getSearchInGroupsQueryOptions(client, 'VIP')
      expect(options.queryKey).toEqual(['groups', 'search', 'VIP'])
    })

    it('is disabled when search string is less than 2 chars', () => {
      const options = getSearchInGroupsQueryOptions(client, 'V')
      expect(options.enabled).toBe(false)
    })

    it('is enabled when search string is 2+ chars', () => {
      const options = getSearchInGroupsQueryOptions(client, 'VI')
      expect(options.enabled).toBe(true)
    })

    it('fetches filtered groups', async () => {
      const options = getSearchInGroupsQueryOptions(client, 'VIP')
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.some((g: any) => g.name.includes('VIP'))).toBe(true)
    })
  })
})
