import { createFileRoute, Outlet, useNavigate } from '@tanstack/react-router'
import GroupsWidget from '../../components/groups/GroupsWidget'
import Logger from '../../utils/logger'
import { getAllGroupsQueryOptions } from '../../api/groupsApi'
import { useQuery } from '@tanstack/react-query'
import { useEffect } from 'react'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/groups')({
  component: GroupsLayout,
})

function GroupsLayout() {
  Logger.debug('Rendering GroupsLayout', { component: 'GroupsLayout' })
  const client = useApiClient()
  const allGroupsQuery = useQuery(getAllGroupsQueryOptions(client))
  const navigate = useNavigate()
  const groups = allGroupsQuery.data

  useEffect(() => {
    const currentPath = window.location.pathname
    const isGroupsIndexRoute = currentPath === '/app/groups' || currentPath === '/app/groups/'

    if (isGroupsIndexRoute && groups && groups.length > 0) {
      const firstGroupId = groups[0].id
      navigate({
        to: '/app/groups/$groupId',
        params: { groupId: firstGroupId },
      })
    }
  }, [groups, navigate])

  if (allGroupsQuery.status === 'error') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-red-600">Error loading groups</div>
      </div>
    )
  }

  if (allGroupsQuery.status === 'pending') {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-gray-600 dark:text-gray-400">Loading groups...</div>
      </div>
    )
  }

  return (
    <div className="flex max-h-[85vh] gap-4">
      <div className="w-1/4 flex-shrink-0">
        <GroupsWidget userGroups={groups} />
      </div>
      <div className="w-3/4 flex-1 min-h-0">
        <Outlet />
      </div>
    </div>
  )
}
