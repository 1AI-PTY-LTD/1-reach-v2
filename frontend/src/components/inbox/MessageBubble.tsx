import dayjs from 'dayjs'
import { Badge } from '../../ui/badge'
import { StatusBadge } from '../StatusBadge'
import type { ThreadItem } from '../../types/conversation.types'

export function MessageBubble({ item }: { item: ThreadItem }) {
  const time = dayjs(item.thread_ts).format('hh:mmA DD/MM/YYYY')

  if (item.direction === 'inbound') {
    return (
      <div className="flex justify-start" data-testid="bubble-inbound">
        <div className="max-w-[75%] rounded-2xl rounded-bl-sm bg-zinc-100 dark:bg-zinc-800 px-4 py-2">
          <p className="text-sm text-zinc-950 dark:text-white whitespace-pre-wrap break-words">
            {item.text}
          </p>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-zinc-500 dark:text-zinc-400">{time}</span>
            {item.is_opt_out && <Badge color="red">Opted out</Badge>}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex justify-end" data-testid="bubble-outbound">
      <div className="max-w-[75%] rounded-2xl rounded-br-sm bg-brand-purple px-4 py-2">
        <p className="text-sm text-white whitespace-pre-wrap break-words">
          {item.text ?? ''}
        </p>
        <div className="flex items-center justify-end gap-2 mt-1">
          <span className="text-xs text-white/70">{time}</span>
          <StatusBadge status={item.status} />
        </div>
      </div>
    </div>
  )
}
