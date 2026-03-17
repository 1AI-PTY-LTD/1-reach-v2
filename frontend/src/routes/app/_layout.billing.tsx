import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useOrganization } from '@clerk/clerk-react'
import { Suspense } from 'react'
import { Badge } from '../../ui/badge'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { useApiClient } from '../../lib/ApiClientProvider'
import { getBillingSummaryQueryOptions } from '../../api/billingApi'
import type { TransactionType } from '../../types/billing.types'

export const Route = createFileRoute('/app/_layout/billing')({
  component: RouteComponent,
  pendingComponent: () => <LoadingSpinner />,
  errorComponent: ({ error }) => (
    <div className="flex flex-col items-center justify-center h-full gap-4 dark:text-white p-8">
      <p className="text-gray-500 dark:text-gray-400">
        {error instanceof Error ? error.message : 'Failed to load billing.'}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
      >
        Retry
      </button>
    </div>
  ),
})

const txTypeBadgeColor: Record<TransactionType, 'green' | 'red' | 'blue' | 'indigo'> = {
  grant: 'green',
  deduct: 'red',
  usage: 'blue',
  refund: 'indigo',
}

function BillingContent() {
  const client = useApiClient()
  const { membership } = useOrganization()
  const isAdmin = membership?.role === 'org:admin'

  const { data } = useSuspenseQuery(getBillingSummaryQueryOptions(client))

  if (!isAdmin) {
    return (
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-8 text-center">
        <p className="text-zinc-500 dark:text-zinc-400">Access restricted to organisation admins.</p>
      </div>
    )
  }

  const isSubscribed = data.billing_mode === 'subscribed'
  const balance = parseFloat(data.balance)
  const spend = parseFloat(data.total_monthly_spend)
  const limit = data.monthly_limit ? parseFloat(data.monthly_limit) : null

  const balanceColor = balance <= 0 ? 'red' : balance < 1 ? 'yellow' : 'green'

  return (
    <div className="space-y-6">
      {/* Mode + Balance */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-white">Billing</h2>
          <Badge color={isSubscribed ? 'green' : 'zinc'}>
            {isSubscribed ? 'Subscribed' : 'Trial'}
          </Badge>
        </div>

        {!isSubscribed && (
          <div className="mb-4">
            <p className="text-sm text-zinc-500 dark:text-zinc-400 mb-1">Trial balance</p>
            <p className="text-3xl font-bold">
              <Badge color={balanceColor}>${data.balance}</Badge>
            </p>
            {balance <= 0 && (
              <p className="mt-2 text-sm text-red-600 dark:text-red-400">
                Balance exhausted. Subscribe to continue sending.
              </p>
            )}
          </div>
        )}

        {isSubscribed && (
          <p className="text-sm text-zinc-500 dark:text-zinc-400">
            Active subscription — usage is tracked and billed at end of month via Clerk Billing.
          </p>
        )}

        {/* Monthly spend vs limit */}
        <div className="mt-4 p-3 bg-zinc-50 dark:bg-zinc-800 rounded-lg">
          <p className="text-sm font-medium text-zinc-700 dark:text-zinc-300">
            Monthly spend: <span className="font-bold">${data.total_monthly_spend}</span>
            {limit !== null ? (
              <span className="text-zinc-500"> / ${data.monthly_limit} limit</span>
            ) : (
              <span className="text-zinc-400"> (no spending limit set)</span>
            )}
          </p>
          {limit !== null && (
            <div className="mt-2 h-2 bg-zinc-200 dark:bg-zinc-700 rounded-full overflow-hidden">
              <div
                className="h-full bg-emerald-500 rounded-full"
                style={{ width: `${Math.min((spend / limit) * 100, 100)}%` }}
              />
            </div>
          )}
        </div>
      </div>

      {/* Per-format usage */}
      {Object.keys(data.monthly_usage_by_format).length > 0 && (
        <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-6">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-4">
            This month's usage
          </h3>
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Format</TableHeader>
                <TableHeader className="text-right">Spend</TableHeader>
                <TableHeader className="text-right">Rate</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {Object.entries(data.monthly_usage_by_format).map(([fmt, info]) => (
                <TableRow key={fmt}>
                  <TableCell>
                    <Badge color="zinc">{fmt.toUpperCase()}</Badge>
                  </TableCell>
                  <TableCell className="text-right">${info.spend}</TableCell>
                  <TableCell className="text-right">${info.rate}/msg</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Transaction history */}
      <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-6">
        <h3 className="text-base font-semibold text-zinc-900 dark:text-white mb-4">
          Transaction history
        </h3>
        {data.results.length === 0 ? (
          <p className="text-sm text-zinc-400 text-center py-4">No transactions yet.</p>
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Date</TableHeader>
                <TableHeader>Type</TableHeader>
                <TableHeader>Format</TableHeader>
                <TableHeader>Description</TableHeader>
                <TableHeader className="text-right">Amount</TableHeader>
                <TableHeader className="text-right">Balance after</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {data.results.map((tx) => (
                <TableRow key={tx.id}>
                  <TableCell className="whitespace-nowrap text-sm text-zinc-500">
                    {new Date(tx.created_at).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Badge color={txTypeBadgeColor[tx.transaction_type]}>
                      {tx.transaction_type}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    {tx.format ? (
                      <Badge color="zinc">{tx.format.toUpperCase()}</Badge>
                    ) : (
                      <span className="text-zinc-400">—</span>
                    )}
                  </TableCell>
                  <TableCell className="text-sm">{tx.description}</TableCell>
                  <TableCell className="text-right font-mono">${tx.amount}</TableCell>
                  <TableCell className="text-right font-mono">${tx.balance_after}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
    </div>
  )
}

function RouteComponent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <BillingContent />
    </Suspense>
  )
}
