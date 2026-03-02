import type { Contact } from './contact.types'

export type ScheduleStatus = 'pending' | 'processing' | 'sent' | 'failed' | 'cancelled'

export type Schedule = {
  id: number
  name?: string | null
  template?: number | null
  text?: string | null
  message_parts: number
  contact?: number | null
  contact_detail?: Contact | null
  phone?: string | null
  group?: number | null
  parent?: number | null
  scheduled_time: string
  sent_time?: string | null
  status: ScheduleStatus
  error?: string | null
  format?: string | null
  media_url?: string | null
  subject?: string | null
  created_at: string
  updated_at: string
}

export type CreateSchedule = {
  template_id?: number | null
  text?: string
  contact_id?: number | null
  phone: string
  scheduled_time: string
  format?: string
  media_url?: string
  subject?: string
}

export type UpdateSchedule = {
  id: number
  contact_id?: number
  scheduled_time?: string
  template_id?: number
  text?: string
}
