import { createFileRoute } from '@tanstack/react-router'
import { Heading } from '../../ui/heading'

export const Route = createFileRoute('/app/_layout/contacts/')({
  component: ContactsIndex,
})

function ContactsIndex() {
  return (
    <div className="flex justify-center">
      <Heading>Select Contact</Heading>
    </div>
  )
}
