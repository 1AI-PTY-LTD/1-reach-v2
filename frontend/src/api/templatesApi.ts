import { queryOptions, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Template, CreateTemplate, UpdateTemplate } from '../types/template.types'
import type { PaginatedResponse } from '../types/pagination.types'
import type { ApiClient } from '../lib/helper'
import Logger from '../utils/logger'

// Query options
export function getAllTemplatesQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['templates'],
    queryFn: async (): Promise<Template[]> => {
      Logger.debug('Fetching all templates', { component: 'templatesApi.getAllTemplates' })
      const data = await client.get<PaginatedResponse<Template>>('/api/templates/?limit=1000')
      Logger.debug('Successfully fetched templates', {
        component: 'templatesApi.getAllTemplates',
        data: { count: data.results.length },
      })
      return data.results
    },
  })
}

export function getTemplateByIdQueryOptions(client: ApiClient, id: number) {
  return queryOptions({
    queryKey: ['templates', id],
    queryFn: async (): Promise<Template> => {
      Logger.debug('Fetching template by ID', {
        component: 'templatesApi.getTemplateById',
        data: { templateId: id },
      })
      return client.get<Template>(`/api/templates/${id}/`)
    },
  })
}

// Mutation hooks
export function useCreateTemplateMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: CreateTemplate) => {
      Logger.debug('Creating new template', { component: 'templatesApi.createTemplate', data: props })
      return client.post<Template>('/api/templates/', props)
    },
    onSuccess: (data) => {
      Logger.info('Template created successfully', {
        component: 'templatesApi.createTemplate',
        data: { templateId: data.id },
      })
      return queryClient.invalidateQueries({ queryKey: ['templates'], exact: true })
    },
    onError: (error) => {
      Logger.error('Failed to create template', {
        component: 'templatesApi.createTemplate',
        data: { error: error.message },
      })
    },
  })
}

export function useUpdateTemplateMutation(client: ApiClient) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (props: UpdateTemplate) => {
      Logger.debug('Updating template', {
        component: 'templatesApi.updateTemplate',
        data: { templateId: props.id },
      })
      const { id, ...updateData } = props
      return client.put<Template>(`/api/templates/${id}/`, updateData)
    },
    onSuccess: (data) => {
      Logger.info('Template updated successfully', {
        component: 'templatesApi.updateTemplate',
        data: { templateId: data.id },
      })
      return queryClient.invalidateQueries({ queryKey: ['templates'] })
    },
    onError: (error) => {
      Logger.error('Failed to update template', {
        component: 'templatesApi.updateTemplate',
        data: { error: error.message },
      })
    },
  })
}
