import { createFileRoute, Outlet, useNavigate, useParams } from '@tanstack/react-router'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { getConversationsQueryOptions } from '../../api/conversationsApi'
import { ConversationList } from '../../components/inbox/ConversationList'
import { useApiClient } from '../../lib/ApiClientProvider'
import Logger from '../../utils/logger'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'

export const Route = createFileRoute('/app/_layout/inbox')({
  component: InboxLayout,
  errorComponent: RouteErrorComponent,
})

export function InboxLayout() {
  Logger.debug('Rendering InboxLayout', { component: 'InboxLayout' })
  const client = useApiClient()
  const conversationsQuery = useQuery(getConversationsQueryOptions(client))
  const navigate = useNavigate()
  const params = useParams({ strict: false }) as { contactId?: number }
  const conversations = conversationsQuery.data?.results

  useEffect(() => {
    if (
      conversations &&
      conversations[0]?.contact_id &&
      window.location.pathname === '/app/inbox'
    ) {
      Logger.info('Navigating to first conversation', {
        component: 'InboxLayout',
        data: { contactId: conversations[0].contact_id },
      })
      navigate({
        to: '/app/inbox/$contactId',
        params: { contactId: conversations[0].contact_id },
      })
    }
  }, [conversations, navigate])

  // Only show the hard error state when there is no cached data — a single
  // failed background poll must not unmount an open thread (and any draft).
  if (conversationsQuery.status === 'error' && !conversations) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-600">Error loading conversations</div>
      </div>
    )
  }

  if (conversationsQuery.status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading conversations...</div>
      </div>
    )
  }

  return (
    <div className="flex">
      <div className="w-1/4 overflow-auto border-light-gray rounded-md mr-4 bg-white dark:bg-zinc-900 shadow-lg max-h-[85vh]">
        <ConversationList
          conversations={conversations ?? []}
          activeContactId={params.contactId}
        />
      </div>
      <div className="w-3/4 overflow-auto border-light-gray rounded-md">
        <Outlet />
      </div>
    </div>
  )
}
