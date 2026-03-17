import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { SignedIn, SignedOut, SignInButton, SignUpButton } from '@clerk/clerk-react'
import type { QueryClient } from '@tanstack/react-query'

// Bypass Clerk auth in local E2E test mode. This variable is set in frontend/.env
// (local dev only) and is never present in production builds.
const E2E_TEST_MODE = import.meta.env.VITE_E2E_TEST_MODE === 'true'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: Root,
  errorComponent: ({ error }) => (
    <div className="flex flex-col items-center justify-center min-h-screen gap-4 dark:text-white p-8">
      <h1 className="text-2xl font-bold">Something went wrong</h1>
      <p className="text-gray-500 dark:text-gray-400 text-center max-w-md">
        {error instanceof Error ? error.message : 'An unexpected error occurred.'}
      </p>
      <button
        onClick={() => window.location.reload()}
        className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700"
      >
        Reload page
      </button>
    </div>
  ),
})

function Root() {
  if (E2E_TEST_MODE) {
    return (
      <div className="md:max-h-screen overflow-hidden">
        <Outlet />
      </div>
    )
  }

  return (
    <div className="md:max-h-screen overflow-hidden">
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4 dark:text-white">
          <h1 className="text-2xl font-bold">Welcome to 1Reach</h1>
          <div className="flex gap-4">
            <SignInButton mode="modal">
              <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-4 py-2 border border-emerald-600 text-emerald-600 rounded-lg hover:bg-emerald-50 dark:text-emerald-400 dark:border-emerald-400 dark:hover:bg-emerald-950">
                Sign Up
              </button>
            </SignUpButton>
          </div>
        </div>
      </SignedOut>
    </div>
  )
}
