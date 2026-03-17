export type BillingMode = 'trial' | 'subscribed' | 'past_due'
export type TransactionType = 'grant' | 'deduct' | 'usage' | 'refund'

export type CreditTransaction = {
  id: number
  transaction_type: TransactionType
  amount: string
  balance_after: string
  description: string
  format: string | null
  schedule: number | null
  created_by: number | null
  created_at: string
}

export type FormatUsageSummary = {
  spend: string
  rate: string
}

export type BillingSummaryResponse = {
  billing_mode: BillingMode
  balance: string
  monthly_limit: string | null
  total_monthly_spend: string
  monthly_usage_by_format: Record<string, FormatUsageSummary>
  results: CreditTransaction[]
  pagination: {
    total: number
    page: number
    limit: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}
