import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Heading } from '../../ui/heading'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table'
import dayjs from 'dayjs'
import { StatusBadge } from '../../components/StatusBadge'
import React, { useState, useEffect, useRef } from 'react'
import { MessageDetails } from '../../components/contacts/MessageDetails'
import { Button } from '../../ui/button'
import { PencilIcon, PlusIcon, ChevronLeftIcon, ChevronRightIcon, ChevronDownIcon, ChevronRightIcon as ChevronRightExpandIcon } from '@heroicons/react/16/solid'
import { Divider } from '../../ui/divider'
import { ContactModal } from '../../components/contacts/CustomerModal'
import { getSchedulesByContactIdQueryOptions } from '../../api/schedulesApi'
import { ContactMessageModal } from '../../components/contacts/CustomerMessageModal'
import { useQuery } from '@tanstack/react-query'
import Logger from '../../utils/logger'
import { getAllContactsQueryOptions, getContactByIdQueryOptions } from '../../api/contactsApi'
import TableSkeleton from '../../components/shared/TableSkeleton'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/contacts/$contactId')({
  component: ContactDetails,
  params: {
    parse: (params) => ({
      contactId: z.coerce.number().int().parse(params.contactId),
    }),
    stringify: ({ contactId }) => ({ contactId: `${contactId}` }),
  },
  errorComponent: ({ error }) => {
    return <div>Contact Not Found {error.message}</div>
  },
})

function ContactDetails() {
  const { contactId } = Route.useParams()
  const client = useApiClient()
  const contactsQuery = useQuery(getAllContactsQueryOptions(client))

  const contactFromList = contactsQuery.data?.find((c) => c.id === contactId)

  const individualContactQuery = useQuery({
    ...getContactByIdQueryOptions(client, contactId),
    enabled: contactsQuery.status === 'success' && !contactFromList,
  })

  const contact = contactFromList || individualContactQuery.data

  const [currentPage, setCurrentPage] = useState(1)
  const [pageSize] = useState(50)
  const contactMessagesQuery = useQuery({
    ...getSchedulesByContactIdQueryOptions(client, contactId, currentPage, pageSize),
    placeholderData: (previousData) => previousData,
  })

  const [selectedRowId, setSelectedRowId] = useState<number | null>(null)
  const [isEditContactOpen, setIsEditContactOpen] = useState<boolean>(false)
  const [isCreateMessageOpen, setIsCreateMessageOpen] = useState<boolean>(false)
  const [showLoader, setShowLoader] = useState(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (contactMessagesQuery.isFetching) {
      setShowLoader(true)
    } else {
      const timer = setTimeout(() => {
        setShowLoader(false)
      }, 150)
      return () => clearTimeout(timer)
    }
  }, [contactMessagesQuery.isFetching])

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [currentPage])

  if (contactsQuery.status === 'error' || (individualContactQuery.isEnabled && individualContactQuery.status === 'error')) {
    return (
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-red-600">Error loading contact details</div>
        </div>
      </div>
    )
  }

  if (contactsQuery.status === 'pending' || (individualContactQuery.isEnabled && individualContactQuery.status === 'pending')) {
    return (
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600">Loading contact...</div>
        </div>
      </div>
    )
  }

  if (!contact) {
    return (
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600">Contact not found</div>
        </div>
      </div>
    )
  }

  const messageTableContent = renderMessageTableContent()

  function renderMessageTableContent() {
    if (contactMessagesQuery.status === 'pending') {
      return (
        <TableRow>
          <TableCell colSpan={6} className="text-center py-8">
            Loading messages...
          </TableCell>
        </TableRow>
      )
    }

    if (contactMessagesQuery.status === 'error') {
      return (
        <TableRow>
          <TableCell colSpan={6} className="text-center py-8 text-red-600">
            Failed to load messages
          </TableCell>
        </TableRow>
      )
    }

    const { data: paginatedData } = contactMessagesQuery
    if (!paginatedData) return null

    const messages = paginatedData.results
    Logger.debug('Rendering message table content', {
      component: 'ContactDetails.renderMessageTableContent',
      data: { messages, pagination: paginatedData.pagination },
    })

    const renderedMessages = messages.map((entry) => (
      <React.Fragment key={entry.id}>
        <TableRow
          onClick={() => setSelectedRowId(selectedRowId === entry.id ? null : entry.id)}
          className={`cursor-pointer hover:bg-zinc-50 dark:hover:bg-zinc-800 ${selectedRowId === entry.id ? 'bg-zinc-100 dark:bg-zinc-800' : ''}`}
        >
          <TableCell className="w-4">
            {selectedRowId === entry.id ? (
              <ChevronDownIcon className="h-4 w-4 text-gray-500" />
            ) : (
              <ChevronRightExpandIcon className="h-4 w-4 text-gray-500" />
            )}
          </TableCell>
          <TableCell>
            <StatusBadge status={entry.status}></StatusBadge>
          </TableCell>
          <TableCell>{dayjs(entry.scheduled_time).format('hh:mmA DD/MM/YYYY')}</TableCell>
          <TableCell>{entry.sent_time ? dayjs(entry.sent_time).format('hh:mmA DD/MM/YYYY') : ''}</TableCell>
          <TableCell className="w-16">{entry.format || 'SMS'}</TableCell>
          <TableCell>{entry.text.length > 40 ? entry.text.substring(0, 40) + '...' : entry.text}</TableCell>
        </TableRow>
        {selectedRowId === entry.id && (
          <TableRow className="bg-zinc-100 dark:bg-zinc-800">
            <TableCell colSpan={6} className="p-0">
              <MessageDetails message={{
                ...entry,
                template_id: entry.template_id ?? undefined,
              }} />
            </TableCell>
          </TableRow>
        )}
      </React.Fragment>
    ))

    return renderedMessages
  }

  return (
    <>
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 max-h-[85vh] bg-white shadow-lg flex flex-col">
        <div className="flex justify-between mb-2">
          <div className="flex gap-4">
            <Button outline onClick={() => setIsEditContactOpen(true)}>
              <PencilIcon />
              <Heading>
                {contact.first_name} {contact.last_name}
              </Heading>
            </Button>
            <Button className="w-12" color="emerald" onClick={() => setIsCreateMessageOpen(true)}>
              <PlusIcon className="fill-white" />
            </Button>
          </div>
          <Heading className="pt-2">
            Phone: {contact.phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')}
          </Heading>
        </div>
        {contactMessagesQuery.data?.pagination && (
          <div className="flex items-center justify-between px-2 py-4 border-b border-zinc-950/10 dark:border-white/10">
            <div className="text-sm text-gray-700">
              Showing {contactMessagesQuery.data.pagination.total === 0 ? 0 : ((contactMessagesQuery.data.pagination.page - 1) * contactMessagesQuery.data.pagination.limit) + 1} to{' '}
              {Math.min(contactMessagesQuery.data.pagination.page * contactMessagesQuery.data.pagination.limit, contactMessagesQuery.data.pagination.total)} of{' '}
              {contactMessagesQuery.data.pagination.total} results
            </div>
            {showLoader && (
              <div className="flex items-center">
                <LoadingSpinner />
              </div>
            )}
            <div className="flex items-center space-x-2">
              <Button
                outline
                onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                disabled={contactMessagesQuery.isFetching || !contactMessagesQuery.data.pagination.hasPrev}
                className="flex items-center gap-1 px-3 py-1.5 text-sm"
              >
                <ChevronLeftIcon className="h-4 w-4" />
                Previous
              </Button>

              <div className="flex items-center space-x-1">
                {Array.from({ length: Math.min(5, contactMessagesQuery.data.pagination.totalPages) }, (_, i) => {
                  const pageNum = Math.max(1, Math.min(
                    contactMessagesQuery.data.pagination.totalPages - 4,
                    contactMessagesQuery.data.pagination.page - 2,
                  )) + i

                  if (pageNum > contactMessagesQuery.data.pagination.totalPages) return null

                  return (
                    <Button
                      key={pageNum}
                      {...(pageNum === contactMessagesQuery.data.pagination.page ? { color: 'emerald' as const } : { outline: true })}
                      onClick={() => setCurrentPage(pageNum)}
                      disabled={contactMessagesQuery.isFetching}
                      className="min-w-[2rem] px-2 py-1.5 text-sm"
                    >
                      {pageNum}
                    </Button>
                  )
                })}
              </div>

              <Button
                outline
                onClick={() => setCurrentPage((prev) => Math.min(contactMessagesQuery.data.pagination.totalPages, prev + 1))}
                disabled={contactMessagesQuery.isFetching || !contactMessagesQuery.data.pagination.hasNext}
                className="flex items-center gap-1 px-3 py-1.5 text-sm"
              >
                Next
                <ChevronRightIcon className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}

        <div className="relative flex-1 min-h-0">
          <div ref={scrollContainerRef} className="overflow-auto" style={{ maxHeight: 'calc(85vh - 200px)' }}>
            <Table>
              <TableHead className="sticky top-0 bg-white dark:bg-zinc-900 z-10">
                <TableRow>
                  <TableHeader className="w-4"></TableHeader>
                  <TableHeader className="w-4">Status</TableHeader>
                  <TableHeader className="w-8">Scheduled Time</TableHeader>
                  <TableHeader className="w-8">Sent Time</TableHeader>
                  <TableHeader className="w-16">Type</TableHeader>
                  <TableHeader>Message</TableHeader>
                </TableRow>
              </TableHead>
              <TableBody>{messageTableContent}</TableBody>
            </Table>
          </div>
        </div>

        <Divider />
        <div className="mt-4 flex justify-end"></div>
      </div>
      <ContactModal contact={contact} isOpen={isEditContactOpen} setIsOpen={setIsEditContactOpen} />
      <ContactMessageModal contact={contact} isOpen={isCreateMessageOpen} setIsOpen={setIsCreateMessageOpen} />
    </>
  )
}
