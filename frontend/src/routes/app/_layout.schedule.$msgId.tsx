import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { Heading } from '../../ui/heading'
import {
  DescriptionDetails,
  DescriptionList,
  DescriptionTerm,
} from '../../ui/description-list'
import dayjs from 'dayjs'
import { StatusBadge } from '../../components/StatusBadge'
import { Divider } from '../../ui/divider'
import { PencilIcon, TrashIcon } from '@heroicons/react/16/solid'
import { Button } from '../../ui/button'

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
      <p className="text-gray-500 mt-2">Select a message from the schedule table to view details.</p>
    </div>
  )
}
