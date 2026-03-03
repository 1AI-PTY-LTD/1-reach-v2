import { createContext, useContext, useMemo } from 'react'
import { useAuth } from '@clerk/clerk-react'
import { ApiClient } from './helper'

const ApiClientContext = createContext<ApiClient | null>(null)

export function ApiClientProvider({ children }: { children: React.ReactNode }) {
  const { getToken } = useAuth()
  const client = useMemo(() => new ApiClient(getToken), [getToken])
  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>
}

export function useApiClient() {
  const client = useContext(ApiClientContext)
  if (!client) throw new Error('useApiClient must be used within ApiClientProvider')
  return client
}
