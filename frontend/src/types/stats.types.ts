export type MonthlyStats = {
  month: string
  sms_sent: number
  sms_message_parts: number
  mms_sent: number
  pending: number
  errored: number
}

export type SummaryData = {
  monthly_stats: MonthlyStats[]
  monthly_limit: string | null
  total_monthly_spend: string
}
