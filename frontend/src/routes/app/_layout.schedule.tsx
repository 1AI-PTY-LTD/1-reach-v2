import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import { Button } from '../../ui/button'
import { useState, useEffect, Suspense, useRef } from 'react'
import dayjs from 'dayjs'
import ScheduleTable from '../../components/ScheduleTable'
import { getAllSchedulesQueryOptions } from '../../api/schedulesApi'
import { useQuery } from '@tanstack/react-query'
import { useApiClient } from '../../lib/ApiClientProvider'
import Logger from '../../utils/logger'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { Heading } from '../../ui/heading'
import type { Schedule } from '../../types'

export const Route = createFileRoute('/app/_layout/schedule')({
  component: ScheduleLayout,
})

function ScheduleContent() {
  Logger.debug('Rendering ScheduleLayout', { component: 'ScheduleLayout' })
  const client = useApiClient()

  const [date, setDate] = useState(dayjs())
  const [currentPage, setCurrentPage] = useState(1)
  const [displayedMessages, setDisplayedMessages] = useState<Schedule[]>([])
  const [selectedMessageId, setSelectedMessageId] = useState<undefined | number>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const messagesQuery = useQuery({
    ...getAllSchedulesQueryOptions(client, date.format('YYYY-MM-DD'), currentPage, 50),
    placeholderData: (previousData) => previousData,
  })

  useEffect(() => {
    if (messagesQuery.data) {
      Logger.debug('Updating displayed messages', {
        component: 'ScheduleLayout',
        data: {
          messageCount: messagesQuery.data.results.length,
          totalCount: messagesQuery.data.pagination.total,
          page: messagesQuery.data.pagination.page,
          date: date.format('YYYY-MM-DD'),
        },
      })
      setDisplayedMessages(messagesQuery.data.results)
    }
  }, [messagesQuery.data])

  useEffect(() => {
    setCurrentPage(1)
    setSelectedMessageId(undefined)
  }, [date])

  useEffect(() => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = 0
    }
  }, [currentPage])

  if (messagesQuery.status === 'pending') {
    return <LoadingSpinner />
  }

  if (messagesQuery.status === 'error') {
    return <div className="text-center py-8 text-red-600">Failed to load messages</div>
  }

  const messages = displayedMessages ?? []

  if (!selectedMessageId && messages && messages.length !== 0) {
    Logger.info('Setting initial selected message', {
      component: 'ScheduleLayout',
      data: { messageId: messages[0].id },
    })
    setSelectedMessageId(messages[0].id)
  }

  const goToPreviousDay = () => {
    const newDate = date.subtract(1, 'day')
    setSelectedMessageId(undefined)
    setDate(newDate)
  }

  const goToNextDay = () => {
    const newDate = date.add(1, 'day')
    setSelectedMessageId(undefined)
    setDate(newDate)
  }

  return (
    <div className="flex flex-col relative flex-1 min-h-0">
      <div className="flex gap-4 justify-between mb-4">
        <Button outline onClick={goToPreviousDay}>
          <ChevronLeftIcon />
        </Button>
        <Heading>{date.format('DD/MM/YYYY')}</Heading>
        <Button outline onClick={goToNextDay}>
          <ChevronRightIcon />
        </Button>
      </div>
      {messagesQuery?.data?.pagination && (
        <div className="flex items-center justify-between px-2 py-4 border-b">
          <div className="text-sm text-gray-700">
            Showing {messagesQuery.data.pagination.total === 0 ? 0 : ((messagesQuery.data.pagination.page - 1) * messagesQuery.data.pagination.limit) + 1} to{' '}
            {Math.min(messagesQuery.data.pagination.page * messagesQuery.data.pagination.limit, messagesQuery.data.pagination.total)} of{' '}
            {messagesQuery.data.pagination.total} results
          </div>

          <div className="h-6 flex items-center justify-center">
            {messagesQuery.isFetching && <LoadingSpinner />}
          </div>

          <div className="flex items-center space-x-2">
            <Button
              outline
              onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
              disabled={messagesQuery.isFetching || !messagesQuery.data.pagination.hasPrev}
              className="flex items-center gap-1 px-3 py-1.5 text-sm"
            >
              <ChevronLeftIcon className="h-4 w-4" />
              Previous
            </Button>

            <div className="flex items-center space-x-1">
              {Array.from({ length: Math.min(5, messagesQuery.data.pagination.totalPages) }, (_, i) => {
                const pageNum = Math.max(1, Math.min(
                  messagesQuery.data.pagination.totalPages - 4,
                  messagesQuery.data.pagination.page - 2,
                )) + i

                if (pageNum > messagesQuery.data.pagination.totalPages) return null

                return (
                  <Button
                    key={pageNum}
                    {...(pageNum === messagesQuery.data.pagination.page ? { color: 'emerald' as const } : { outline: true })}
                    onClick={() => setCurrentPage(pageNum)}
                    disabled={messagesQuery.isFetching}
                    className="min-w-[2rem] px-2 py-1.5 text-sm"
                  >
                    {pageNum}
                  </Button>
                )
              })}
            </div>

            <Button
              outline
              onClick={() => setCurrentPage((prev) => Math.min(messagesQuery.data.pagination.totalPages, prev + 1))}
              disabled={messagesQuery.isFetching || !messagesQuery.data.pagination.hasNext}
              className="flex items-center gap-1 px-3 py-1.5 text-sm"
            >
              Next
              <ChevronRightIcon className="h-4 w-4" />
            </Button>
          </div>
        </div>
      )}
      <div className="relative flex-1 min-h-0 overflow-auto" ref={scrollContainerRef}>
        <ScheduleTable
          messages={messages}
          selectedMessageId={selectedMessageId}
          setSelectedMessageId={setSelectedMessageId}
        />
      </div>
    </div>
  )
}

function ScheduleLayout() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 max-h-[85vh] bg-white shadow-lg flex flex-col">
        <ScheduleContent />
      </div>
    </Suspense>
  )
}
