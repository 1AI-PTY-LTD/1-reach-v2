import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import ContactsWidget from '../../components/contacts/Customers'
import { getAllContactsQueryOptions } from '../../api/contactsApi'
import { useEffect } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useApiClient } from '../../lib/ApiClientProvider'
import Logger from '../../utils/logger'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'

export const Route = createFileRoute('/app/_layout/contacts')({
  component: ContactsLayout,
  errorComponent: RouteErrorComponent,
})

function ContactsLayout() {
  Logger.debug('Rendering ContactsLayout', { component: 'ContactsLayout' })
  const client = useApiClient()
  const allContactsQuery = useQuery(getAllContactsQueryOptions(client))
  const navigate = useNavigate()
  const contacts = allContactsQuery.data

  useEffect(() => {
    if (
      contacts &&
      contacts[0]?.id &&
      window.location.pathname === '/app/contacts'
    ) {
      Logger.info('Navigating to first contact', {
        component: 'ContactsLayout',
        data: { contactId: contacts[0].id },
      })
      navigate({
        to: '/app/contacts/$contactId',
        params: { contactId: contacts[0].id },
      })
    }
  }, [contacts, navigate])

  if (allContactsQuery.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-600">Error loading contacts</div>
      </div>
    )
  }

  if (allContactsQuery.status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading contacts...</div>
      </div>
    )
  }

  return (
    <div className="flex">
      <div className="w-1/4 overflow-hidden border-light-gray rounded-md mr-4 bg-white dark:bg-zinc-900 shadow-lg">
        <ContactsWidget contacts={contacts ?? []} />
      </div>
      <div className="w-3/4 overflow-auto border-light-gray rounded-md">
        <Outlet />
      </div>
    </div>
  )
}
