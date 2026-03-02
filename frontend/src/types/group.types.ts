import type { Contact } from './contact.types'

export type ContactGroup = {
  id: number
  name: string
  description?: string | null
  is_active: boolean
  member_count: number
  created_at: string
  updated_at: string
}

export type ContactGroupDetail = ContactGroup & {
  members: Contact[]
}

export type CreateGroup = {
  name: string
  description?: string | null
  member_ids?: number[]
}

export type UpdateGroup = {
  id: number
  name?: string
  description?: string | null
  is_active?: boolean
}
