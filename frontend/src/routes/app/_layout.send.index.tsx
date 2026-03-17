import { createFileRoute, Navigate } from '@tanstack/react-router'

export const Route = createFileRoute('/app/_layout/send/')({
  component: () => <Navigate to="/app/send" />,
})
