import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import GroupsWidget from '../../components/groups/GroupsWidget'
import Logger from '../../utils/logger'
import { getAllGroupsQueryOptions } from '../../api/groupsApi'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/groups')({
  component: GroupsLayout,
})

function GroupsLayout() {
  Logger.debug('Rendering GroupsLayout', { component: 'GroupsLayout' })
  const client = useApiClient()
  const allGroupsQuery = useSuspenseQuery(getAllGroupsQueryOptions(client))
  const navigate = useNavigate()

  useEffect(() => {
    const currentPath = window.location.pathname
    const isGroupsIndexRoute = currentPath === '/app/groups' || currentPath === '/app/groups/'

    if (isGroupsIndexRoute && allGroupsQuery.data.length > 0) {
      const firstGroupId = allGroupsQuery.data[0].id
      navigate({
        to: '/app/groups/$groupId',
        params: { groupId: firstGroupId },
      })
    }
  }, [allGroupsQuery.data, navigate])

  return (
    <div className="flex max-h-[85vh] gap-4">
      <div className="w-1/4 flex-shrink-0">
        <GroupsWidget userGroups={allGroupsQuery.data} />
      </div>
      <div className="w-3/4 flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
