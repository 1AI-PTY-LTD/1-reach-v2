import { createRootRouteWithContext, Outlet } from '@tanstack/react-router'
import { SignedIn, SignedOut, SignInButton, SignUpButton } from '@clerk/clerk-react'
import type { QueryClient } from '@tanstack/react-query'

export const Route = createRootRouteWithContext<{
  queryClient: QueryClient
}>()({
  component: Root,
  errorComponent: (props) => {
    return (
      <div>
        <div className="p-4">
          <h1 className="text-2xl font-bold mb-2">Error</h1>
          <pre className="whitespace-pre-wrap">
            {JSON.stringify(props.error, null, 2)}
          </pre>
        </div>
      </div>
    )
  },
})

function Root() {
  return (
    <div className="md:max-h-screen overflow-hidden">
      <SignedIn>
        <Outlet />
      </SignedIn>
      <SignedOut>
        <div className="flex flex-col items-center justify-center min-h-screen gap-4">
          <h1 className="text-2xl font-bold">Welcome to 1Reach</h1>
          <div className="flex gap-4">
            <SignInButton mode="modal">
              <button className="px-4 py-2 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700">
                Sign In
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-4 py-2 border border-emerald-600 text-emerald-600 rounded-lg hover:bg-emerald-50">
                Sign Up
              </button>
            </SignUpButton>
          </div>
        </div>
      </SignedOut>
    </div>
  )
}
