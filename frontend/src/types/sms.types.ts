export type SendSmsRequest = {
  message: string
  recipient: string
  contact_id?: number | null
}

export type SendGroupSmsRequest = {
  message: string
  group_id: number
}

export type SendMmsRequest = {
  message: string
  media_url: string
  recipient: string
  contact_id?: number | null
  subject?: string
}

export type SendSmsResponse = {
  success: boolean
  message: string
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
