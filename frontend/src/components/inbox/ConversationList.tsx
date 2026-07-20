import { Link } from '@tanstack/react-router'
import dayjs from 'dayjs'
import { Badge } from '../../ui/badge'
import type { Conversation } from '../../types/conversation.types'
import { conversationDisplayName, formatPhone } from '../../types/conversation.types'

function formatWhen(timestamp: string): string {
  const time = dayjs(timestamp)
  return time.isSame(dayjs(), 'day') ? time.format('hh:mmA') : time.format('DD/MM/YYYY')
}

export function ConversationList({
  conversations,
  activeContactId,
}: {
  conversations: Conversation[]
  activeContactId?: number
}) {
  if (conversations.length === 0) {
    return (
      <div className="flex items-center justify-center py-16 px-4 text-center">
        <p className="text-zinc-400 dark:text-zinc-500">
          No conversations yet. Replies to two-way messages will appear here.
        </p>
      </div>
    )
  }

  return (
    <ul data-testid="conversation-list">
      {conversations.map((conversation) => {
        const isActive = conversation.contact_id === activeContactId
        return (
          <li key={conversation.contact_id}>
            <Link
              to="/app/inbox/$contactId"
              params={{ contactId: conversation.contact_id }}
              className={`block px-4 py-3 border-b border-zinc-950/5 dark:border-white/5 hover:bg-zinc-50 dark:hover:bg-zinc-800 ${
                isActive ? 'bg-zinc-100 dark:bg-zinc-800' : ''
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-medium text-zinc-950 dark:text-white truncate">
                  {conversationDisplayName(conversation.contact_detail)}
                </span>
                <span className="text-xs text-zinc-500 dark:text-zinc-400 shrink-0">
                  {formatWhen(conversation.last_inbound_at)}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2 mt-1">
                <span className="text-sm text-zinc-500 dark:text-zinc-400 truncate">
                  {conversation.last_inbound_text}
                </span>
                {conversation.unread_count > 0 && (
                  <Badge color="purple" data-testid="unread-badge">
                    {conversation.unread_count}
                  </Badge>
                )}
              </div>
              <div className="text-xs text-zinc-400 dark:text-zinc-500 mt-0.5">
                {formatPhone(conversation.contact_detail.phone)}
              </div>
            </Link>
          </li>
        )
      })}
    </ul>
  )
}
