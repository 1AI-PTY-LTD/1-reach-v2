import { createFileRoute } from '@tanstack/react-router'
import TemplatesWidget from '../../components/Templates'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'

export const Route = createFileRoute('/app/_layout/templates')({
  component: TemplatesLayout,
  errorComponent: RouteErrorComponent,
})

function TemplatesLayout() {
  return (
    <div className="flex flex-col">
      <TemplatesWidget />
    </div>
  )
}
