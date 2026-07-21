import type { Contact } from './contact.types'
import type { Schedule } from './schedule.types'
import { hasTransientSchedule } from './schedule.types'

/** An SMS reply received via the provider webhook (two-way SMS). */
export type InboundMessage = {
  id: number
  contact: number | null
  schedule: number | null
  phone: string
  text: string
  received_at: string
  read_at: string | null
  read_by: number | null
  is_opt_out: boolean
  created_at: string
}

/** One conversation-list row: a contact with at least one inbound reply. */
export type Conversation = {
  contact_id: number
  contact_detail: Contact
  last_inbound_text: string
  last_inbound_at: string
  unread_count: number
}

export type OutboundThreadItem = Schedule & {
  direction: 'outbound'
  thread_ts: string
}

export type InboundThreadItem = InboundMessage & {
  direction: 'inbound'
  thread_ts: string
}

export type ThreadItem = OutboundThreadItem | InboundThreadItem

/**
 * Cursor-paginated thread envelope. Not the standard results/pagination
 * shape: the thread merges two tables under live inserts, so the backend
 * paginates by timestamp cursor (`next_before`) instead of page numbers.
 */
export type ThreadResponse = {
  results: ThreadItem[]
  total: number
  has_more: boolean
  next_before: string | null
}

export type UnreadCountResponse = {
  unread: number
}

/**
 * Poll cadence (ms) for an open thread: snappy while an outbound message is
 * in flight, steady 15s otherwise — a reply can arrive at any moment inside
 * the provider's reply window, so an open thread never goes fully idle.
 */
export function threadPollInterval(items: ThreadItem[]): number {
  const outbound = items.filter(
    (item): item is OutboundThreadItem => item.direction === 'outbound',
  )
  if (hasTransientSchedule(outbound)) return 2000
  if (outbound.some((s) => s.status === 'sent')) return 5000
  return 15000
}

export function formatPhone(phone: string): string {
  return phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')
}

/** Contacts auto-created from replies have blank names — fall back to the phone. */
export function conversationDisplayName(contact: Contact): string {
  const name = `${contact.first_name} ${contact.last_name}`.trim()
  return name || formatPhone(contact.phone)
}
