import { createFileRoute } from '@tanstack/react-router'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import { Button } from '../../ui/button'
import { useState, useRef, Suspense } from 'react'
import dayjs from 'dayjs'
import ScheduleTable from '../../components/ScheduleTable'
import { getAllSchedulesInfiniteOptions } from '../../api/schedulesApi'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useApiClient } from '../../lib/ApiClientProvider'
import Logger from '../../utils/logger'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import DatePicker from '../../components/DatePicker'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll'

export const Route = createFileRoute('/app/_layout/schedule')({
  component: ScheduleLayout,
  errorComponent: RouteErrorComponent,
})

function ScheduleContent() {
  Logger.debug('Rendering ScheduleLayout', { component: 'ScheduleLayout' })
  const client = useApiClient()

  const [date, setDate] = useState(dayjs())
  const [selectedMessageId, setSelectedMessageId] = useState<undefined | number>()
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const messagesQuery = useInfiniteQuery(
    getAllSchedulesInfiniteOptions(client, date.format('YYYY-MM-DD'), 50)
  )

  const sentinelRef = useInfiniteScroll({
    scrollContainerRef,
    hasNextPage: messagesQuery.hasNextPage,
    isFetchingNextPage: messagesQuery.isFetchingNextPage,
    fetchNextPage: messagesQuery.fetchNextPage,
  })

  if (messagesQuery.status === 'pending') {
    return <LoadingSpinner />
  }

  if (messagesQuery.status === 'error') {
    return <div className="text-center py-8 text-red-600">Failed to load messages</div>
  }

  const messages = messagesQuery.data?.pages.flatMap((page) => page.results) ?? []
  const totalCount = messagesQuery.data?.pages[0]?.pagination.total ?? 0

  if (!selectedMessageId && messages.length !== 0) {
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
        <DatePicker value={date} onChange={(d) => { setSelectedMessageId(undefined); setDate(d) }} />
        <Button outline onClick={goToNextDay}>
          <ChevronRightIcon />
        </Button>
      </div>
      {totalCount > 0 && (
        <div className="flex items-center justify-between px-2 py-4 border-b dark:border-white/10">
          <div className="text-sm text-gray-700 dark:text-gray-300">
            Showing {messages.length} of {totalCount} results
          </div>
          <div className="h-6 flex items-center justify-center">
            {messagesQuery.isLoading && <LoadingSpinner />}
          </div>
        </div>
      )}
      <div className="relative flex-1 min-h-0 overflow-auto" ref={scrollContainerRef}>
        {messages.length === 0 && !messagesQuery.isFetching ? (
          <div className="flex items-center justify-center py-16">
            <p className="text-zinc-400 dark:text-zinc-500">No messages scheduled for this date</p>
          </div>
        ) : (
          <ScheduleTable
            messages={messages}
            selectedMessageId={selectedMessageId}
            setSelectedMessageId={setSelectedMessageId}
          />
        )}
        <div ref={sentinelRef} className="h-1" />
        {messagesQuery.isFetchingNextPage && (
          <div className="flex justify-center py-4">
            <LoadingSpinner />
          </div>
        )}
      </div>
    </div>
  )
}

function ScheduleLayout() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 max-h-[85vh] bg-white dark:bg-zinc-900 shadow-lg flex flex-col">
        <ScheduleContent />
      </div>
    </Suspense>
  )
}
