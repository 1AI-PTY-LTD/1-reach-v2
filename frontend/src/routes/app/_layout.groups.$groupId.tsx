import * as React from 'react'
import { createFileRoute } from '@tanstack/react-router'
import { z } from 'zod'
import { getAllGroupsQueryOptions } from '../../api/groupsApi'
import TabbedContainer from '../../components/TabbedContainer'
import type { TabbedContainerProps } from '../../components/TabbedContainer'
import GroupUsersDetails from '../../components/groups/GroupUsersDetails'
import { useQuery } from '@tanstack/react-query'
import { Heading } from '../../ui/heading'
import { Button } from '../../ui/button'
import { PencilIcon } from '@heroicons/react/16/solid'
import GroupsModal from '../../components/groups/GroupsModal'
import GroupSchedulesDetails from '../../components/groups/GroupSchedulesDetails'
import { useApiClient } from '../../lib/ApiClientProvider'
import RouteErrorComponent from '../../components/shared/RouteErrorComponent'

export const Route = createFileRoute('/app/_layout/groups/$groupId')({
  component: GroupsComponent,
  params: {
    parse: (params) => ({
      groupId: z.coerce.number().int().parse(params.groupId),
    }),
    stringify: ({ groupId }) => ({ groupId: `${groupId}` }),
  },
  errorComponent: RouteErrorComponent,
})

function GroupsComponent() {
  const { groupId } = Route.useParams()
  const client = useApiClient()
  const groupsQuery = useQuery(getAllGroupsQueryOptions(client))
  const [isModalOpen, setIsModalOpen] = React.useState(false)

  const group = groupsQuery.data?.find((g) => g.id === groupId)
  const groupName = group?.name || ''
  const memberCount = group?.member_count

  if (groupsQuery.status === 'error') {
    return (
      <div className="h-full flex flex-col justify-start overflow-hidden border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-red-600">Error loading group details</div>
        </div>
      </div>
    )
  }

  if (groupsQuery.status === 'success' && !group) {
    return (
      <div className="h-full flex flex-col justify-start overflow-hidden border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
        <div className="flex items-center justify-center h-full">
          <div className="text-gray-600 dark:text-gray-400">Group not found</div>
        </div>
      </div>
    )
  }

  const tabbedContainerOptions: TabbedContainerProps = {
    tabs: [
      {
        id: 'messages',
        label: 'Messages',
        content: <GroupSchedulesDetails groupId={groupId} />,
        disabled: false,
      },
      {
        id: 'users',
        label: 'Contacts',
        content: <GroupUsersDetails groupId={groupId} />,
        disabled: false,
      },
    ],
  }

  return (
    <div className="h-full flex flex-col justify-start overflow-hidden border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
      <TabbedContainer
        tabs={tabbedContainerOptions.tabs}
        label={
          <div className="flex items-center space-x-3">
            <Button outline onClick={() => setIsModalOpen(true)}>
              <PencilIcon />
              <Heading>{groupName}</Heading>
            </Button>
            {memberCount !== undefined && (
              <span className="text-base text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900 px-3 py-1.5 rounded-full">
                {memberCount} member{memberCount !== 1 ? 's' : ''}
              </span>
            )}
          </div>
        }
      />
      <GroupsModal groupId={groupId} isOpen={isModalOpen} setIsOpen={setIsModalOpen} />
    </div>
  )
}
