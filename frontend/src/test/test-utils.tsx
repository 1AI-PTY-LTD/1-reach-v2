import { render, type RenderOptions } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { ApiClient } from '../lib/helper'
import { ApiClientProvider } from '../lib/ApiClientProvider'
import type { ReactElement, ReactNode } from 'react'

// Create a mock ApiClient that uses the mock token
function createMockApiClient() {
  return new ApiClient(async () => 'mock-token')
}

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        gcTime: Infinity,
        staleTime: Infinity,
      },
      mutations: {
        retry: false,
      },
    },
  })
}

interface WrapperProps {
  children: ReactNode
}

function createWrapper() {
  const queryClient = createTestQueryClient()

  function Wrapper({ children }: WrapperProps) {
    return (
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider>
          {children}
        </ApiClientProvider>
      </QueryClientProvider>
    )
  }

  return { Wrapper, queryClient }
}

export function renderWithProviders(
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) {
  const { Wrapper, queryClient } = createWrapper()
  const result = render(ui, { wrapper: Wrapper, ...options })
  return { ...result, queryClient }
}

// Re-export everything from testing-library
export * from '@testing-library/react'
export { default as userEvent } from '@testing-library/user-event'

// Export utilities
export { createWrapper, createTestQueryClient, createMockApiClient }
