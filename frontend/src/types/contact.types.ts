export type Contact = {
  id: number
  first_name: string
  last_name: string
  phone: string
  email?: string | null
  company?: string | null
  is_active: boolean
  opt_out: boolean
  created_at: string
  updated_at: string
}

export type CreateContact = {
  first_name: string
  last_name: string
  phone: string
  email?: string
  company?: string
}
