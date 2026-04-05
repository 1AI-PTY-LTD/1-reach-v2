import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Heading } from '../../ui/heading'

export const Route = createFileRoute('/app/_layout/schedule/$msgId')({
  component: MessageDetails,
  params: {
    parse: (params) => ({
      msgId: z.coerce.number().int().parse(params.msgId),
    }),
    stringify: ({ msgId }) => ({ msgId: `${msgId}` }),
  },
})

function MessageDetails() {
  return (
    <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10">
      <Heading>Message Details</Heading>
      <p className="text-gray-500 dark:text-gray-400 mt-2">Select a message from the schedule table to view details.</p>
    </div>
  )
}
