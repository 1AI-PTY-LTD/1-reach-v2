import { queryOptions, infiniteQueryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Schedule, CreateSchedule, UpdateSchedule } from '../types/schedule.types'
import type { PaginatedResponse } from '../types/pagination.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

// V2 paginated response uses "results" key
export type PaginatedSchedules = PaginatedResponse<Schedule>

// Query options
export function getAllSchedulesQueryOptions(client: ApiClient, date: string, page: number = 1, limit: number = 50) {
  return queryOptions({
    queryKey: ['schedules', date, page, limit],
    queryFn: async (): Promise<PaginatedSchedules> => {
      Logger.debug('Fetching all schedules', {
        component: 'schedulesApi.getAllSchedules',
        data: { date, page, limit },
      })
      const params = new URLSearchParams()
      params.append('date', date)
      params.append('page', page.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedSchedules>(`/api/schedules/?${params.toString()}`)
      Logger.debug('Successfully fetched schedules', {
        component: 'schedulesApi.getAllSchedules',
        data: {
          count: data.results.length,
          total: data.pagination.total,
          page: data.pagination.page,
          date,
        },
      })
      return data
    },
    refetchInterval: 60000,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
}

export function getSchedulesByContactIdQueryOptions(
  client: ApiClient,
  contactId: number,
  page: number = 1,
  limit: number = 10
) {
  return queryOptions({
    queryKey: ['schedules', 'contact', contactId, page, limit],
    queryFn: async (): Promise<PaginatedSchedules> => {
      Logger.debug('Fetching schedules by contact ID', {
        component: 'schedulesApi.getSchedulesByContactId',
        data: { contactId, page, limit },
      })
      const params = new URLSearchParams()
      params.append('page', page.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedSchedules>(
        `/api/contacts/${contactId}/schedules/?${params.toString()}`
      )
      Logger.info('Successfully fetched schedules by contact ID', {
        component: 'schedulesApi.getSchedulesByContactId',
        data: {
          contactId,
          count: data.results.length,
          total: data.pagination.total,
        },
      })
      return data
    },
    refetchInterval: 60000,
    staleTime: page === 1 ? 0 : 30000,
    refetchOnWindowFocus: true,
  })
}

// Infinite query options
export function getAllSchedulesInfiniteOptions(client: ApiClient, date: string, limit: number = 50) {
  return infiniteQueryOptions({
    queryKey: ['schedules', date, 'infinite', limit],
    queryFn: async ({ pageParam }): Promise<PaginatedSchedules> => {
      Logger.debug('Fetching schedules (infinite)', {
        component: 'schedulesApi.getAllSchedulesInfinite',
        data: { date, page: pageParam, limit },
      })
      const params = new URLSearchParams()
      params.append('date', date)
      params.append('page', pageParam.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedSchedules>(`/api/schedules/?${params.toString()}`)
      return data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasNext ? lastPage.pagination.page + 1 : undefined,
    refetchInterval: 60000,
    staleTime: 0,
    refetchOnMount: true,
    refetchOnWindowFocus: true,
  })
}

export function getSchedulesByContactIdInfiniteOptions(
  client: ApiClient,
  contactId: number,
  limit: number = 50,
) {
  return infiniteQueryOptions({
    queryKey: ['schedules', 'contact', contactId, 'infinite', limit],
    queryFn: async ({ pageParam }): Promise<PaginatedSchedules> => {
      Logger.debug('Fetching schedules by contact (infinite)', {
        component: 'schedulesApi.getSchedulesByContactIdInfinite',
        data: { contactId, page: pageParam, limit },
      })
      const params = new URLSearchParams()
      params.append('page', pageParam.toString())
      params.append('limit', limit.toString())
      const data = await client.get<PaginatedSchedules>(
        `/api/contacts/${contactId}/schedules/?${params.toString()}`
      )
      return data
    },
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.hasNext ? lastPage.pagination.page + 1 : undefined,
    refetchInterval: 60000,
    staleTime: 0,
    refetchOnWindowFocus: true,
  })
}

// Recipients query (children of a batch parent)
export function getScheduleRecipientsQueryOptions(client: ApiClient, scheduleId: number) {
  return queryOptions({
    queryKey: ['schedules', scheduleId, 'recipients'],
    queryFn: () => client.get<Schedule[]>(`/api/schedules/${scheduleId}/recipients/`),
    enabled: !!scheduleId,
  })
}

// Mutation hooks
export function useCreateScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: CreateSchedule) => {
      Logger.debug('Creating new schedule', { component: 'schedulesApi.createSchedule', data: props })
      return client.post<Schedule>('/api/schedules/', props)
    },
    onSuccess: (_data, variables) => {
      Logger.info('Schedule created successfully', { component: 'schedulesApi.createSchedule' })
      queryClient.invalidateQueries({
        queryKey: ['schedules', 'contact', variables.contact_id],
      })
    },
    onError: (error) => {
      Logger.error('Error creating schedule', {
        component: 'schedulesApi.createSchedule',
        data: { error: error.message },
      })
    },
  })
}

export function useCancelScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (id: number) => {
      Logger.debug('Cancelling schedule', {
        component: 'schedulesApi.cancelSchedule',
        data: { scheduleId: id },
      })
      return client.del<void>(`/api/schedules/${id}/`)
    },
    onSuccess: (_, id) => {
      Logger.info('Schedule cancelled successfully', {
        component: 'schedulesApi.cancelSchedule',
        data: { scheduleId: id },
      })
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (error) => {
      Logger.error('Error cancelling schedule', {
        component: 'schedulesApi.cancelSchedule',
        data: { error: error.message },
      })
    },
  })
}

export function useUpdateScheduleMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: UpdateSchedule) => {
      Logger.debug('Updating schedule', {
        component: 'schedulesApi.updateSchedule',
        data: { scheduleId: props.id },
      })
      const { id, ...updateData } = props
      return client.put<Schedule>(`/api/schedules/${id}/`, updateData)
    },
    onSuccess: (_data, variables) => {
      Logger.info('Schedule updated successfully', {
        component: 'schedulesApi.updateSchedule',
        data: { scheduleId: variables.id },
      })
      queryClient.invalidateQueries({
        queryKey: ['schedules', 'contact', variables.contact_id],
      })
      queryClient.invalidateQueries({ queryKey: ['schedules'] })
    },
    onError: (error) => {
      Logger.error('Error updating schedule', {
        component: 'schedulesApi.updateSchedule',
        data: { error: error.message },
      })
    },
  })
}
