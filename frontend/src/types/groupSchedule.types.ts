export type GroupSchedule = {
  id: number
  name: string
  template?: number | null
  text?: string | null
  group: {
    id: number
    name: string
  }
  scheduled_time: string
  status: string
  created_at: string
  updated_at: string
  child_count: number
  schedules?: {
    id: number
    contact?: { id: number; first_name: string; last_name: string; phone: string } | null
    phone: string
    status: string
    scheduled_time?: string | null
    sent_time?: string | null
  }[]
}

export type CreateGroupSchedule = {
  name: string
  template_id?: number | null
  text?: string | null
  group_id: number
  scheduled_time: string
}

export type UpdateGroupSchedule = {
  template_id?: number | null
  text?: string | null
  scheduled_time?: string
}
