import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { useEffect, useRef } from 'react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Heading } from '../../ui/heading'
import { getThreadInfiniteOptions, useMarkReadMutation } from '../../api/conversationsApi'
import { getContactByIdQueryOptions } from '../../api/contactsApi'
import { conversationDisplayName, formatPhone } from '../../types/conversation.types'
import { MessageBubble } from '../../components/inbox/MessageBubble'
import { ReplyComposer } from '../../components/inbox/ReplyComposer'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { useApiClient } from '../../lib/ApiClientProvider'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'

export const Route = createFileRoute('/app/_layout/inbox/$contactId')({
  component: ConversationThread,
  params: {
    parse: (params) => ({
      contactId: z.coerce.number().int().parse(params.contactId),
    }),
    stringify: ({ contactId }) => ({ contactId: `${contactId}` }),
  },
  errorComponent: ({ error }) => {
    return <div>Conversation Not Found {error.message}</div>
  },
})

export function ConversationThread() {
  const { contactId } = Route.useParams()
  const client = useApiClient()

  const contactQuery = useQuery(getContactByIdQueryOptions(client, contactId))
  const threadQuery = useInfiniteQuery(getThreadInfiniteOptions(client, contactId, 50))
  const markRead = useMarkReadMutation(client)

  // Pages arrive newest-first; display oldest-at-top like a chat.
  const items = (threadQuery.data?.pages ?? []).flatMap((page) => page.results)
  const displayItems = [...items].reverse()

  const scrollRef = useRef<HTMLDivElement>(null)
  const prevScrollHeightRef = useRef(0)
  // True while the user is at (or near) the newest message — only then do new
  // arrivals auto-scroll, so reading older history is never yanked away from.
  const nearBottomRef = useRef(true)

  // Older pages load from a sentinel at the TOP of the scroll area.
  const sentinelRef = useInfiniteScroll({
    scrollContainerRef: scrollRef,
    hasNextPage: threadQuery.hasNextPage,
    isFetchingNextPage: threadQuery.isFetchingNextPage,
    fetchNextPage: threadQuery.fetchNextPage,
    rootMargin: '200px 0px 0px 0px',
  })

  // Preserve the reading position when an older page is prepended above.
  useEffect(() => {
    if (threadQuery.isFetchingNextPage && scrollRef.current) {
      prevScrollHeightRef.current = scrollRef.current.scrollHeight
    }
  }, [threadQuery.isFetchingNextPage])

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    if (prevScrollHeightRef.current && el.scrollHeight > prevScrollHeightRef.current) {
      el.scrollTop += el.scrollHeight - prevScrollHeightRef.current
      prevScrollHeightRef.current = 0
    }
  }, [threadQuery.data?.pages.length])

  // Jump to the newest message on load and whenever one arrives — but only
  // while the user is already near the bottom (or hasn't scrolled yet).
  const newest = displayItems[displayItems.length - 1]
  const newestKey = newest ? `${newest.direction}-${newest.id}` : null
  useEffect(() => {
    const el = scrollRef.current
    if (el && newestKey && nearBottomRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [newestKey])

  // Viewing the thread reads it. Keyed on dataUpdatedAt so it self-heals: a
  // reply landing mid-round-trip or a failed mark-read POST is retried on the
  // next poll refetch instead of wedging on an unchanged boolean.
  const hasUnread = items.some(
    (item) => item.direction === 'inbound' && !item.read_at
  )
  useEffect(() => {
    if (hasUnread && !markRead.isPending) {
      markRead.mutate(contactId)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasUnread, threadQuery.dataUpdatedAt, contactId])

  if (contactQuery.status === 'error') {
    return (
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-red-600">Error loading conversation</div>
        </div>
      </div>
    )
  }

  // The thread shell renders even while the contact is still loading — the
  // scroll container must exist for the infinite-scroll observer and the
  // initial jump-to-newest to attach on first open.
  const contact = contactQuery.data

  return (
    <div className="border rounded-lg border-zinc-950/10 dark:border-white/10 max-h-[85vh] bg-white dark:bg-zinc-900 shadow-lg flex flex-col">
      <div className="flex justify-between items-center px-4 py-3 border-b border-zinc-950/10 dark:border-white/10">
        <Heading>{contact ? conversationDisplayName(contact) : 'Loading…'}</Heading>
        <span className="text-sm text-zinc-500 dark:text-zinc-400">
          {contact ? formatPhone(contact.phone) : ''}
        </span>
      </div>

      <div
        ref={scrollRef}
        onScroll={(e) => {
          const el = e.currentTarget
          nearBottomRef.current =
            el.scrollHeight - el.scrollTop - el.clientHeight < 150
        }}
        className="flex-1 min-h-0 overflow-auto p-4"
        style={{ maxHeight: 'calc(85vh - 180px)' }}
        data-testid="thread-scroll"
      >
        <div ref={sentinelRef} className="h-1" />
        {threadQuery.isFetchingNextPage && (
          <div className="flex justify-center py-2">
            <LoadingSpinner />
          </div>
        )}
        {threadQuery.status === 'pending' && (
          <div className="flex justify-center py-8">
            <LoadingSpinner />
          </div>
        )}
        {threadQuery.status === 'error' && (
          <div className="flex justify-center py-8 text-red-600">
            Failed to load messages
          </div>
        )}
        {threadQuery.status === 'success' && displayItems.length === 0 && (
          <div className="flex justify-center py-8 text-zinc-400 dark:text-zinc-500">
            No messages in this conversation yet
          </div>
        )}
        <div className="flex flex-col gap-2">
          {displayItems.map((item) => (
            <MessageBubble key={`${item.direction}-${item.id}`} item={item} />
          ))}
        </div>
      </div>

      {contact && <ReplyComposer contact={contact} />}
    </div>
  )
}
