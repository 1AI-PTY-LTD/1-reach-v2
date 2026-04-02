export type SendSmsRecipient = {
  phone: string
  contact_id?: number | null
}

export type SendSmsRequest = {
  message: string
  recipients: SendSmsRecipient[]
}

export type SendGroupSmsRequest = {
  message: string
  group_id: number
}

export type SendMmsRequest = {
  message: string
  media_url: string
  recipients: SendSmsRecipient[]
  subject?: string
}

export type SendSmsResponse = {
  success: boolean
  message: string
  schedule_id?: number
  parent_schedule_id?: number
  total?: number
}

export type SendGroupSmsResponse = {
  success: boolean
  message: string
  results: {
    successful: number
    failed: number
    total: number
  }
  group_name: string
  group_schedule_id: number
}

export type FileUploadResponse = {
  success: boolean
  url?: string
  file_id?: string
  size?: number
  error?: string
}
