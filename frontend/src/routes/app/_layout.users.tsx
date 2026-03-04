import { createFileRoute } from '@tanstack/react-router'
import { useSuspenseQuery } from '@tanstack/react-query'
import { useOrganization, useUser } from '@clerk/clerk-react'
import { Suspense } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '../../ui/table'
import { Badge } from '../../ui/badge'
import { Button } from '../../ui/button'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import { useApiClient } from '../../lib/ApiClientProvider'
import { getAllUsersQueryOptions, useUpdateUserRoleMutation, useToggleUserStatusMutation } from '../../api/usersApi'

export const Route = createFileRoute('/app/_layout/users')({
  component: RouteComponent,
  pendingComponent: () => <LoadingSpinner />,
})

function UsersContent() {
  const client = useApiClient()
  const { data: users } = useSuspenseQuery(getAllUsersQueryOptions(client))
  const { membership } = useOrganization()
  const { user: clerkUser } = useUser()
  const updateRole = useUpdateUserRoleMutation(client)
  const toggleStatus = useToggleUserStatusMutation(client)

  const isAdmin = membership?.role === 'org:admin'

  const handleToggleRole = (userId: number, currentRole: string) => {
    const newRole = currentRole === 'org:admin' ? 'org:member' : 'org:admin'
    updateRole.mutate({ userId, role: newRole })
  }

  const handleToggleStatus = (userId: number, currentlyActive: boolean) => {
    toggleStatus.mutate({ userId, isActive: !currentlyActive })
  }

  return (
    <div className="bg-white dark:bg-zinc-900 rounded-lg shadow-lg border dark:border-white/10 p-4">
      <Table className="max-h-[80vh]">
        <TableHead>
          <TableRow>
            <TableHeader>Name</TableHeader>
            <TableHeader>Email</TableHeader>
            <TableHeader>Organisation</TableHeader>
            <TableHeader>Role</TableHeader>
            <TableHeader>Status</TableHeader>
            {isAdmin && <TableHeader className="text-center">Actions</TableHeader>}
          </TableRow>
        </TableHead>
        <TableBody>
          {users.map((user) => {
            const isSelf = clerkUser?.id === user.clerk_id
            return (
              <TableRow key={user.id} className={!user.is_active ? 'opacity-50' : ''}>
                <TableCell>
                  {user.first_name} {user.last_name}
                  {isSelf && (
                    <span className="ml-2 text-xs text-zinc-400">(you)</span>
                  )}
                </TableCell>
                <TableCell>{user.email}</TableCell>
                <TableCell>{user.organisation}</TableCell>
                <TableCell>
                  <Badge color={user.role === 'org:admin' ? 'emerald' : 'zinc'}>
                    {user.role === 'org:admin' ? 'Admin' : 'Member'}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Badge color={user.is_active ? 'green' : 'red'}>
                    {user.is_active ? 'Active' : 'Inactive'}
                  </Badge>
                </TableCell>
                {isAdmin && (
                  <TableCell className="text-center">
                    {!isSelf && (
                      <div className="flex gap-2 justify-center">
                        <Button
                          outline
                          onClick={() => handleToggleRole(user.id, user.role)}
                          disabled={updateRole.isPending}
                        >
                          {user.role === 'org:admin' ? 'Revoke Admin' : 'Make Admin'}
                        </Button>
                        <Button
                          outline
                          onClick={() => handleToggleStatus(user.id, user.is_active)}
                          disabled={toggleStatus.isPending}
                        >
                          {user.is_active ? 'Deactivate' : 'Re-invite'}
                        </Button>
                      </div>
                    )}
                  </TableCell>
                )}
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </div>
  )
}

function RouteComponent() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <UsersContent />
    </Suspense>
  )
}
