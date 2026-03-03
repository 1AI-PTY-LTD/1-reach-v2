import { describe, it, expect } from 'vitest'
import {
  getAllContactsQueryOptions,
  getSearchContactsQueryOptions,
  getContactByIdQueryOptions,
  getAllContactsExcludingGroupQueryOptions,
  searchContactsExcludingGroupQueryOptions,
} from '../contactsApi'
import { createMockApiClient } from '../../test/test-utils'

describe('contactsApi', () => {
  const client = createMockApiClient()

  describe('getAllContactsQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllContactsQueryOptions(client)
      expect(options.queryKey).toEqual(['contacts'])
    })

    it('has a queryFn', () => {
      const options = getAllContactsQueryOptions(client)
      expect(options.queryFn).toBeDefined()
    })

    it('fetches contacts from API', async () => {
      const options = getAllContactsQueryOptions(client)
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.length).toBeGreaterThan(0)
      expect(result[0]).toHaveProperty('first_name')
      expect(result[0]).toHaveProperty('phone')
    })
  })

  describe('getSearchContactsQueryOptions', () => {
    it('returns correct query key with search term', () => {
      const options = getSearchContactsQueryOptions(client, 'Alice')
      expect(options.queryKey).toEqual(['searchContacts', 'Alice'])
    })

    it('is disabled when search string is less than 2 chars', () => {
      const options = getSearchContactsQueryOptions(client, 'A')
      expect(options.enabled).toBe(false)
    })

    it('is enabled when search string is 2+ chars', () => {
      const options = getSearchContactsQueryOptions(client, 'Al')
      expect(options.enabled).toBe(true)
    })

    it('fetches filtered contacts', async () => {
      const options = getSearchContactsQueryOptions(client, 'Alice')
      const result = await options.queryFn!({} as any)
      expect(Array.isArray(result)).toBe(true)
      expect(result.some((c: any) => c.first_name === 'Alice')).toBe(true)
    })
  })

  describe('getContactByIdQueryOptions', () => {
    it('returns correct query key with id', () => {
      const options = getContactByIdQueryOptions(client, 1)
      expect(options.queryKey).toEqual(['contacts', 1])
    })

    it('fetches contact by ID', async () => {
      const options = getContactByIdQueryOptions(client, 1)
      const result = await options.queryFn!({} as any)
      expect(result).toHaveProperty('id', 1)
      expect(result).toHaveProperty('first_name')
    })
  })

  describe('getAllContactsExcludingGroupQueryOptions', () => {
    it('returns correct query key', () => {
      const options = getAllContactsExcludingGroupQueryOptions(client, 5)
      expect(options.queryKey).toEqual(['contacts', 'excludeGroup', 5])
    })
  })

  describe('searchContactsExcludingGroupQueryOptions', () => {
    it('returns correct query key', () => {
      const options = searchContactsExcludingGroupQueryOptions(client, 'Alice', 5)
      expect(options.queryKey).toEqual(['searchContacts', 'Alice', 'excludeGroup', 5])
    })

    it('is disabled when search string is less than 2 chars', () => {
      const options = searchContactsExcludingGroupQueryOptions(client, 'A', 5)
      expect(options.enabled).toBe(false)
    })
  })
})
