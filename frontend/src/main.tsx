import { StrictMode, useMemo } from 'react'
import { createRoot } from 'react-dom/client'
import * as Sentry from '@sentry/react'
import './index.css'
import { ClerkProvider } from '@clerk/clerk-react'
import { dark } from '@clerk/themes'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RouterProvider, createRouter } from '@tanstack/react-router'
import { ApiClientProvider } from './lib/ApiClientProvider'
import { routeTree } from './routeTree.gen'
import { LoadingSpinner } from './components/shared/LoadingSpinner'
import { Toaster } from 'sonner'
import { usePrefersDark } from './hooks/usePrefersDark'

if (import.meta.env.VITE_SENTRY_DSN) {
  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.VITE_SENTRY_ENVIRONMENT || 'production',
    tracesSampleRate: 0.1,
  })
}

const PUBLISHABLE_KEY = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!PUBLISHABLE_KEY) {
  throw new Error('Add your Clerk Publishable Key to the .env file')
}

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 0,
      retry: 1,
    },
  },
})

const router = createRouter({
  routeTree,
  context: { queryClient },
  defaultPreload: 'intent',
  defaultPendingComponent: () => <LoadingSpinner />,
  defaultPendingMinMs: 200,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

function App() {
  const isDark = usePrefersDark()
  const clerkAppearance = useMemo(
    () =>
      isDark
        ? {
            baseTheme: dark,
            variables: {
              colorPrimary: '#7400f6',
              colorPrimaryForeground: 'white',
              colorDanger: '#FC7091',
              colorSuccess: '#2CDFB5',
              colorWarning: '#FEC200',
              colorBackground: '#18181b',
              colorInputBackground: '#27272a',
              colorNeutral: 'white',
              colorText: '#fafafa',
              colorTextSecondary: '#a1a1aa',
              colorForeground: '#fafafa',
              colorMutedForeground: '#a1a1aa',
            },
          }
        : {
            variables: {
              colorPrimary: '#7400f6',
              colorDanger: '#FC7091',
              colorSuccess: '#2CDFB5',
              colorWarning: '#FEC200',
            },
          },
    [isDark],
  )

  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY} appearance={clerkAppearance}>
      <QueryClientProvider client={queryClient}>
        <ApiClientProvider>
          <RouterProvider router={router} />
          <Toaster position="bottom-right" richColors closeButton />
        </ApiClientProvider>
      </QueryClientProvider>
    </ClerkProvider>
  )
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
