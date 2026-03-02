import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { GroupSchedule, CreateGroupSchedule, UpdateGroupSchedule } from '../types/groupSchedule.types'
import type { PaginatedResponse } from '../types/pagination.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

export type PaginatedGroupSchedules = PaginatedResponse<GroupSchedule>

// Query options
export function getAllGroupSchedulesQueryOptions(
  client: ApiClient,
  date?: string,
  groupId?: number,
  page: number = 1,
  limit: number = 10
) {
  return queryOptions({
    queryKey: ['group-schedules', date || 'all', groupId || 'all', page, limit],
    queryFn: async (): Promise<PaginatedGroupSchedules> => {
      Logger.debug('Fetching all group schedules', {
        component: 'groupSchedulesApi.getAllGroupSchedules',
        data: { date, groupId, page, limit },
      })
      const params = new URLSearchParams()
      if (date) params.append('date', date)
      if (groupId) params.append('group_id', groupId.toString())
      params.append('page', page.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedGroupSchedules>(`/api/group-schedules/?${params.toString()}`)
      Logger.debug('Successfully fetched group schedules', {
        component: 'groupSchedulesApi.getAllGroupSchedules',
        data: {
          count: data.results.length,
          total: data.pagination.total,
          date,
          groupId,
        },
      })
      return data
    },
    refetchInterval: 60 * 1000,
    staleTime: 30 * 1000,
  })
}

export function getGroupScheduleByIdQueryOptions(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: ['group-schedules', id],
    queryFn: async (): Promise<GroupSchedule> => {
      Logger.debug('Fetching group schedule by ID', {
        component: 'groupSchedulesApi.getGroupScheduleById',
        data: { id },
      })
      const data = await client.get<GroupSchedule>(`/api/group-schedules/${id}/`)
      Logger.info('Successfully fetched group schedule by ID', {
        component: 'groupSchedulesApi.getGroupScheduleById',
        data: { id, name: data.name, childCount: data.child_count },
      })
      return data
    },
    refetchInterval: 60 * 1000,
    staleTime: 0,
  })
}

// Mutation hooks
export function useCreateGroupScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: CreateGroupSchedule) => {
      Logger.debug('Creating new group schedule', {
        component: 'groupSchedulesApi.createGroupSchedule',
        data: { name: props.name, groupId: props.group_id, scheduledTime: props.scheduled_time },
      })
      return client.post<GroupSchedule>('/api/group-schedules/', props)
    },
    onSuccess: (data) => {
      Logger.info('Group schedule created successfully', {
        component: 'groupSchedulesApi.createGroupSchedule',
        data: { id: data.id, name: data.name, childCount: data.child_count },
      })
      queryClient.invalidateQueries({ queryKey: ['group-schedules'], refetchType: 'active' })
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (error) => {
      Logger.error('Failed to create group schedule', {
        component: 'groupSchedulesApi.createGroupSchedule',
        data: { error: error.message },
      })
    },
  })
}

export function useUpdateGroupScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ id, ...props }: { id: number } & UpdateGroupSchedule) => {
      Logger.debug('Updating group schedule', {
        component: 'groupSchedulesApi.updateGroupSchedule',
        data: { id, ...props },
      })
      return client.put<GroupSchedule>(`/api/group-schedules/${id}/`, props)
    },
    onSuccess: (data) => {
      Logger.info('Group schedule updated successfully', {
        component: 'groupSchedulesApi.updateGroupSchedule',
        data: { id: data.id, name: data.name },
      })
      queryClient.invalidateQueries({ queryKey: ['group-schedules'], refetchType: 'active' })
    },
    onError: (error) => {
      Logger.error('Failed to update group schedule', {
        component: 'groupSchedulesApi.updateGroupSchedule',
        data: { error: error.message },
      })
    },
  })
}

export function useDeleteGroupScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => {
      Logger.debug('Deleting group schedule', {
        component: 'groupSchedulesApi.deleteGroupSchedule',
        data: { id },
      })
      return client.del<void>(`/api/group-schedules/${id}/`)
    },
    onSuccess: (_, id) => {
      Logger.info('Group schedule deleted successfully', {
        component: 'groupSchedulesApi.deleteGroupSchedule',
        data: { id },
      })
      queryClient.invalidateQueries({ queryKey: ['group-schedules'], refetchType: 'active' })
    },
    onError: (error) => {
      Logger.error('Failed to delete group schedule', {
        component: 'groupSchedulesApi.deleteGroupSchedule',
        data: { error: error.message },
      })
    },
  })
}
