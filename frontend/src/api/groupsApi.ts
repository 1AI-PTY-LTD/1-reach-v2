import { queryOptions, infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ContactGroup, CreateGroup, UpdateGroup } from '../types/group.types'
import type { PaginatedResponse, Pagination } from '../types/pagination.types'
import type { Contact } from '../types/contact.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

export type GroupDetailResponse = ContactGroup & {
  members: Contact[]
  pagination?: Pagination
}

export type AddMembersToGroup = {
  group_id: number
  contact_ids: number[]
}

export type RemoveMembersFromGroup = {
  group_id: number
  contact_ids: number[]
}

export type MemberOperationResponse = {
  message: string
  added_count?: number
  removed_count?: number
}

// Query options
export function getAllGroupsQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['groups'],
    queryFn: async (): Promise<ContactGroup[]> => {
      Logger.debug('Fetching all groups', { component: 'groupsApi.getAllGroups' })
      const data = await client.get<PaginatedResponse<ContactGroup>>('/api/groups/?limit=1000')
      Logger.debug('Successfully fetched groups', {
        component: 'groupsApi.getAllGroups',
        data: { groupCount: data.results.length },
      })
      return data.results
    },
    staleTime: 5 * 60 * 1000,
  })
}

export function getGroupByIdQueryOptions(client: ApiClient, groupId: number, page: number = 1, limit: number = 10) {
  return queryOptions({
    queryKey: ['groups', groupId, page, limit],
    queryFn: async (): Promise<GroupDetailResponse> => {
      Logger.debug('Fetching group by ID', {
        component: 'groupsApi.getGroupById',
        data: { groupId, page, limit },
      })
      const params = new URLSearchParams()
      if (page) params.append('page', page.toString())
      if (limit) params.append('limit', limit.toString())
      const url = `/api/groups/${groupId}/${params.toString() ? '?' + params.toString() : ''}`
      const data = await client.get<GroupDetailResponse>(url)
      Logger.debug('Successfully fetched group', {
        component: 'groupsApi.getGroupById',
        data: { groupId, groupName: data.name, memberCount: data.member_count },
      })
      return data
    },
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
    refetchOnReconnect: true,
  })
}

export function getGroupMembersInfiniteOptions(client: ApiClient, groupId: number, limit: number = 10) {
  return infiniteQueryOptions({
    queryKey: ['groups', groupId, 'members', 'infinite', limit],
    queryFn: async ({ pageParam }): Promise<GroupDetailResponse> => {
      Logger.debug('Fetching group members (infinite)', {
        component: 'groupsApi.getGroupMembersInfinite',
        data: { groupId, page: pageParam, limit },
      })
      const params = new URLSearchParams()
      params.append('page', pageParam.toString())
      params.append('limit', limit.toString())
      const data = await client.get<GroupDetailResponse>(`/api/groups/${groupId}/?${params.toString()}`)
      return data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination?.hasNext ? lastPage.pagination.page + 1 : undefined,
    staleTime: 30 * 1000,
    refetchOnWindowFocus: true,
  })
}

export function getSearchInGroupsQueryOptions(client: ApiClient, searchTerm: string) {
  return queryOptions({
    queryKey: ['groups', 'search', searchTerm],
    queryFn: async (): Promise<ContactGroup[]> => {
      Logger.debug('Searching groups', { component: 'groupsApi.searchInGroups', data: { searchTerm } })
      const data = await client.get<PaginatedResponse<ContactGroup>>(`/api/groups/?search=${encodeURIComponent(searchTerm)}&limit=1000`)
      Logger.debug('Successfully searched groups', {
        component: 'groupsApi.searchInGroups',
        data: { searchTerm, groupCount: data.results.length },
      })
      return data.results
    },
    staleTime: 60 * 1000,
    enabled: searchTerm.length >= 2,
  })
}

// Mutation hooks
export function useCreateGroupMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: CreateGroup) => {
      Logger.debug('Creating new group', { component: 'groupsApi.createGroup', data: props })
      return client.post<ContactGroup>('/api/groups/', props)
    },
    onSuccess: (data) => {
      Logger.info('Group created successfully', {
        component: 'groupsApi.createGroup',
        data: { groupId: data.id, groupName: data.name },
      })
      queryClient.invalidateQueries({ queryKey: ['groups'], exact: true })
    },
    onError: (error) => {
      Logger.error('Error creating group', {
        component: 'groupsApi.createGroup',
        data: { error: error.message },
      })
    },
  })
}

export function useUpdateGroupMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: UpdateGroup) => {
      const { id, ...updateData } = props
      return client.put<ContactGroup>(`/api/groups/${id}/`, updateData)
    },
    onSuccess: (data, variables) => {
      Logger.info('Group updated successfully', {
        component: 'groupsApi.updateGroup',
        data: { groupId: data.id, groupName: data.name },
      })
      queryClient.invalidateQueries({ queryKey: ['groups', variables.id] })
      queryClient.invalidateQueries({ queryKey: ['groups'], exact: true })
    },
    onError: (error) => {
      Logger.error('Error updating group', {
        component: 'groupsApi.updateGroup',
        data: { error: error.message },
      })
    },
  })
}

export function useDeleteGroupMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (groupId: number) => {
      return client.del<void>(`/api/groups/${groupId}/`)
    },
    onSuccess: (_, groupId) => {
      Logger.info('Group deleted successfully', {
        component: 'groupsApi.deleteGroup',
        data: { groupId },
      })
      queryClient.removeQueries({ queryKey: ['groups', groupId] })
      queryClient.invalidateQueries({ queryKey: ['groups'], exact: true })
    },
    onError: (error) => {
      Logger.error('Error deleting group', {
        component: 'groupsApi.deleteGroup',
        data: { error: error.message },
      })
    },
  })
}

export function useAddMembersToGroupMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: AddMembersToGroup) => {
      Logger.debug('Adding members to group', {
        component: 'groupsApi.addMembersToGroup',
        data: { groupId: props.group_id, contactCount: props.contact_ids.length },
      })
      return client.post<MemberOperationResponse>(`/api/groups/${props.group_id}/members/`, {
        contact_ids: props.contact_ids,
      })
    },
    onSuccess: (data, variables) => {
      Logger.info('Members added to group successfully', {
        component: 'groupsApi.addMembersToGroup',
        data: { groupId: variables.group_id, addedCount: data.added_count },
      })
      queryClient.invalidateQueries({ queryKey: ['groups', variables.group_id] })
      queryClient.invalidateQueries({ queryKey: ['contacts', 'excludeGroup', variables.group_id] })
    },
    onError: (error) => {
      Logger.error('Error adding members to group', {
        component: 'groupsApi.addMembersToGroup',
        data: { error: error.message },
      })
    },
  })
}

export function useRemoveMembersFromGroupMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: RemoveMembersFromGroup) => {
      Logger.debug('Removing members from group', {
        component: 'groupsApi.removeMembersFromGroup',
        data: { groupId: props.group_id, contactCount: props.contact_ids.length },
      })
      return client.del<MemberOperationResponse>(`/api/groups/${props.group_id}/members/`, {
        contact_ids: props.contact_ids,
      })
    },
    onSuccess: (data, variables) => {
      Logger.info('Members removed from group successfully', {
        component: 'groupsApi.removeMembersFromGroup',
        data: { groupId: variables.group_id, removedCount: data.removed_count },
      })
      queryClient.invalidateQueries({ queryKey: ['groups', variables.group_id] })
      queryClient.invalidateQueries({ queryKey: ['groups'], exact: true })
      queryClient.invalidateQueries({ queryKey: ['contacts', 'excludeGroup', variables.group_id] })
    },
    onError: (error) => {
      Logger.error('Error removing members from group', {
        component: 'groupsApi.removeMembersFromGroup',
        data: { error: error.message },
      })
    },
  })
}
