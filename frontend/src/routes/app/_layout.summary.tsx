import { createFileRoute } from '@tanstack/react-router'
import { getSummaryQueryOptions } from '../../api/statsApi'
import { useSuspenseQuery } from '@tanstack/react-query'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table'
import { Suspense } from 'react'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/summary')({
  component: RouteComponent,
  pendingComponent: () => <LoadingSpinner />,
})

function SummaryContent() {
  const client = useApiClient()
  const { data } = useSuspenseQuery(getSummaryQueryOptions(client))

  const statsTableContent = data.monthly_stats.map(
    ({ month, sms_sent, sms_message_parts, mms_sent, pending, errored }, index) => (
      <TableRow key={index}>
        <TableCell>{month}</TableCell>
        <TableCell className="text-center">{sms_sent}</TableCell>
        <TableCell className="text-center">{sms_message_parts}</TableCell>
        <TableCell className="text-center">{mms_sent}</TableCell>
        <TableCell className="text-center">{pending}</TableCell>
        <TableCell className="text-center">{errored}</TableCell>
      </TableRow>
    ),
  )

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-4">
      <div className="mb-4 p-3 bg-green-50 dark:bg-green-950/30 border border-green-200 dark:border-green-800 rounded-lg">
        <h3 className="text-sm font-semibold text-green-800 dark:text-green-200">
          Monthly SMS limit: {data.sms_limit.toLocaleString()}; MMS limit: {data.mms_limit.toLocaleString()}
        </h3>
      </div>
      <Table className="max-h-[80vh]">
        <TableHead>
          <TableRow>
            <TableHeader>Month</TableHeader>
            <TableHeader className="text-center">SMS Sent</TableHeader>
            <TableHeader className="text-center">SMS Message Parts</TableHeader>
            <TableHeader className="text-center">MMS Total</TableHeader>
            <TableHeader className="text-center">Pending</TableHeader>
            <TableHeader className="text-center">Errored</TableHeader>
          </TableRow>
        </TableHead>
        <TableBody>{statsTableContent}</TableBody>
      </Table>
    </div>
  )
}

function RouteComponent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SummaryContent />
    </Suspense>
  )
}
