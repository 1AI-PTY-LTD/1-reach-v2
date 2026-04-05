export type Template = {
  id: number
  name: string
  text: string
  is_active: boolean
  version: number
  created_at: string
  updated_at: string
}

export type CreateTemplate = {
  name: string
  text: string
}

export type UpdateTemplate = {
  id: number
  name?: string
  text?: string
  is_active?: boolean
}
