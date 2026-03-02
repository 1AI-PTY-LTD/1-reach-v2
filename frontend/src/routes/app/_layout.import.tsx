import { createFileRoute, Outlet } from '@tanstack/react-router'

export const Route = createFileRoute('/app/_layout/import')({
  component: ImportLayout,
})

function ImportLayout() {
  return (
    <div className="max-h-[85vh] flex flex-col">
      <Outlet />
    </div>
  )
}
