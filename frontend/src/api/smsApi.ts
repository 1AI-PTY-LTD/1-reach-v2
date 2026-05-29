import { queryOptions } from '@tanstack/react-query'
import type { ApiClient } from '../lib/helper'
import type {
  SendSmsRequest,
  SendGroupSmsRequest,
  SendMmsRequest,
  SendSmsResponse,
  SendGroupSmsResponse,
  FileUploadResponse,
} from '../types/sms.types'
import Logger from '../utils/logger'

export type AlphanumericSendersResponse = {
  alphanumeric_senders: string[]
}

export function alphanumericSendersQueryOptions(client: ApiClient) {
  return queryOptions({
    queryKey: ['alphanumeric-senders'],
    queryFn: () => client.get<AlphanumericSendersResponse>('/api/sms/alphanumeric-senders/'),
  })
}

export async function sendSms(client: ApiClient, props: SendSmsRequest): Promise<SendSmsResponse> {
  Logger.debug('Sending SMS', {
    component: 'smsApi.sendSms',
    data: {
      recipientCount: props.recipients.length,
      messageLength: props.message.length,
    },
  })

  const data = await client.post<SendSmsResponse>('/api/sms/send/', {
    message: props.message,
    recipients: props.recipients,
    ...(props.group_id && { group_id: props.group_id }),
    ...(props.alphanumeric_sender && { alphanumeric_sender: props.alphanumeric_sender }),
  })

  Logger.info('SMS sent successfully', {
    component: 'smsApi.sendSms',
    data: { recipientCount: props.recipients.length },
  })

  return data
}

export async function sendSmsToGroup(client: ApiClient, props: SendGroupSmsRequest): Promise<SendGroupSmsResponse> {
  Logger.debug('Sending SMS to group', {
    component: 'smsApi.sendSmsToGroup',
    data: { groupId: props.group_id, messageLength: props.message.length },
  })

  const data = await client.post<SendGroupSmsResponse>('/api/sms/send-to-group/', {
    message: props.message,
    group_id: props.group_id,
    ...(props.alphanumeric_sender && { alphanumeric_sender: props.alphanumeric_sender }),
  })

  Logger.info('SMS sent to group successfully', {
    component: 'smsApi.sendSmsToGroup',
    data: {
      groupId: props.group_id,
      groupName: data.group_name,
      successful: data.results.successful,
      failed: data.results.failed,
      total: data.results.total,
    },
  })

  return data
}

export async function sendMms(client: ApiClient, props: SendMmsRequest): Promise<SendSmsResponse> {
  Logger.debug('Sending MMS', {
    component: 'smsApi.sendMms',
    data: {
      recipientCount: props.recipients.length,
      messageLength: props.message.length,
      hasMediaUrl: !!props.media_url,
      hasSubject: !!props.subject,
    },
  })

  const data = await client.post<SendSmsResponse>('/api/sms/send-mms/', {
    message: props.message,
    recipients: props.recipients,
    media_url: props.media_url,
    ...(props.group_id && { group_id: props.group_id }),
    ...(props.subject && { subject: props.subject }),
    ...(props.alphanumeric_sender && { alphanumeric_sender: props.alphanumeric_sender }),
  })

  Logger.info('MMS sent successfully', {
    component: 'smsApi.sendMms',
    data: { recipientCount: props.recipients.length },
  })

  return data
}

export async function uploadImageFile(client: ApiClient, file: File): Promise<FileUploadResponse> {
  Logger.debug('Uploading image file', {
    component: 'smsApi.uploadImageFile',
    data: { fileName: file.name, fileSize: file.size, fileType: file.type },
  })

  const data = await client.uploadFile<FileUploadResponse>('/api/sms/upload-file/', file)

  Logger.info('Image file uploaded successfully', {
    component: 'smsApi.uploadImageFile',
    data: { url: data.url, fileId: data.file_id, size: data.size },
  })

  return data
}
