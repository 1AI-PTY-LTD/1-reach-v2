import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Contact, CreateContact } from '../types/contact.types'
import type { PaginatedResponse } from '../types/pagination.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

// Query option factories
export function getAllContactsQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['contacts'],
    queryFn: async (): Promise<Contact[]> => {
      Logger.debug('Fetching all contacts', { component: 'contactsApi.getAllContacts' })
      const data = await client.get<PaginatedResponse<Contact>>('/api/contacts/?limit=1000')
      Logger.debug('Successfully fetched contacts', {
        component: 'contactsApi.getAllContacts',
        data: { count: data.results.length },
      })
      return data.results
    },
  })
}

export function getAllContactsExcludingGroupQueryOptions(client: ApiClient, excludeGroupId: number) {
  return queryOptions({
    queryKey: ['contacts', 'excludeGroup', excludeGroupId],
    queryFn: async (): Promise<Contact[]> => {
      Logger.debug('Fetching contacts excluding group', {
        component: 'contactsApi.getAllContactsExcludingGroup',
        data: { excludeGroupId },
      })
      const data = await client.get<PaginatedResponse<Contact>>(`/api/contacts/?exclude_group_id=${excludeGroupId}&limit=1000`)
      Logger.debug('Successfully fetched contacts excluding group', {
        component: 'contactsApi.getAllContactsExcludingGroup',
        data: { count: data.results.length, excludeGroupId },
      })
      return data.results
    },
  })
}

export function getSearchContactsQueryOptions(client: ApiClient, searchString: string) {
  return queryOptions({
    queryKey: ['searchContacts', searchString],
    queryFn: async (): Promise<Contact[]> => {
      Logger.debug('Searching contacts', {
        component: 'contactsApi.searchContacts',
        data: { searchTerm: searchString },
      })
      const data = await client.get<PaginatedResponse<Contact>>(`/api/contacts/?search=${encodeURIComponent(searchString)}&limit=1000`)
      Logger.debug('Search completed successfully', {
        component: 'contactsApi.searchContacts',
        data: { resultsCount: data.results.length },
      })
      return data.results
    },
    enabled: searchString.length >= 2,
  })
}

export function searchContactsExcludingGroupQueryOptions(client: ApiClient, searchString: string, excludeGroupId: number) {
  return queryOptions({
    queryKey: ['searchContacts', searchString, 'excludeGroup', excludeGroupId],
    queryFn: async (): Promise<Contact[]> => {
      const data = await client.get<PaginatedResponse<Contact>>(
        `/api/contacts/?search=${encodeURIComponent(searchString)}&exclude_group_id=${excludeGroupId}&limit=1000`
      )
      return data.results
    },
    enabled: searchString.length >= 2,
  })
}

export function getContactByIdQueryOptions(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: ['contacts', id],
    queryFn: async (): Promise<Contact> => {
      Logger.debug('Fetching contact by ID', {
        component: 'contactsApi.getContactById',
        data: { contactId: id },
      })
      return client.get<Contact>(`/api/contacts/${id}/`)
    },
  })
}

// Mutation hooks
export function useCreateContactMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: CreateContact) => {
      Logger.debug('Creating new contact', { component: 'contactsApi.createContact', data: props })
      return client.post<Contact>('/api/contacts/', props)
    },
    onSuccess: () => {
      Logger.info('Contact created successfully', { component: 'contactsApi.createContact' })
      return queryClient.invalidateQueries({ queryKey: ['contacts'], exact: true })
    },
    onError: (error) => {
      Logger.error('Failed to create contact', {
        component: 'contactsApi.createContact',
        data: { error: error.message },
      })
    },
  })
}

export function useUpdateContactMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: Contact) => {
      Logger.debug('Updating contact', { component: 'contactsApi.updateContact', data: { contactId: props.id } })
      const { id, ...updateData } = props
      return client.put<Contact>(`/api/contacts/${id}/`, updateData)
    },
    onSuccess: (data) => {
      Logger.info('Contact updated successfully', {
        component: 'contactsApi.updateContact',
        data: { contactId: data.id },
      })
      return queryClient.invalidateQueries({ queryKey: ['contacts'] })
    },
    onError: (error) => {
      Logger.error('Failed to update contact', {
        component: 'contactsApi.updateContact',
        data: { error: error.message },
      })
    },
  })
}

export async function uploadContactsFile(client: ApiClient, file: File) {
  Logger.debug('Uploading contacts file', {
    component: 'contactsApi.uploadContactsFile',
    data: { fileName: file.name, fileSize: file.size },
  })
  const data = await client.uploadFile<{ status: string; message: string; filename?: string }>(
    '/api/contacts/import/',
    file
  )
  Logger.info('Successfully uploaded contacts file', {
    component: 'contactsApi.uploadContactsFile',
    data: { filename: data.filename },
  })
  return data
}
