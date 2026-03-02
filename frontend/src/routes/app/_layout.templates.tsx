import { createFileRoute } from '@tanstack/react-router'
import TemplatesWidget from '../../components/Templates'

export const Route = createFileRoute('/app/_layout/templates')({
  component: TemplatesLayout,
})

function TemplatesLayout() {
  return (
    <div className="flex flex-col">
      <TemplatesWidget />
    </div>
  )
}
