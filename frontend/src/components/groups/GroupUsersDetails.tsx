import { useQuery } from '@tanstack/react-query'
import { getGroupByIdQueryOptions, useRemoveMembersFromGroupMutation } from '../../api/groupsApi'
import { useState } from 'react'
import AddContactsToGroupModal from './AddContactsToGroupModal'
import { Button } from '../../ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table'
import { TrashIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import { Dialog, DialogTitle, DialogDescription, DialogBody, DialogActions } from '../../ui/dialog'
import { PlusIcon } from '@heroicons/react/20/solid'
import LoadingSpinner from '../shared/LoadingSpinner'
import TableSkeleton from '../shared/TableSkeleton'
import { useApiClient } from '../../lib/ApiClientProvider'


export default function GroupUsersDetails({groupId} : {groupId: number}){
    const client = useApiClient()
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [isConfirmDialogOpen, setIsConfirmDialogOpen] = useState(false)
    const [memberToRemove, setMemberToRemove] = useState<{id: number, name: string} | null>(null)
    const [currentPage, setCurrentPage] = useState(1)
    const [pageSize] = useState(10)
    const groupQuery = useQuery({
        ...getGroupByIdQueryOptions(client, groupId, currentPage, pageSize),
        placeholderData: (previousData) => previousData, // Keep previous data during refetch
    })
    const removeMembersMutation = useRemoveMembersFromGroupMutation(client);

    const handleRemoveMemberClick = (memberId: number, memberName: string) => {
        setMemberToRemove({ id: memberId, name: memberName });
        setIsConfirmDialogOpen(true);
    };

    const handleConfirmRemove = () => {
        if (memberToRemove) {
            removeMembersMutation.mutate({ group_id: groupId, contact_ids: [memberToRemove.id] });
            setIsConfirmDialogOpen(false);
            setMemberToRemove(null);
        }
    };

    const handleCancelRemove = () => {
        setIsConfirmDialogOpen(false);
        setMemberToRemove(null);
    };

    // Show skeleton loading while data is loading
    if (groupQuery.status === "pending") {
        return (
            <TableSkeleton
                columns={['First Name', 'Last Name', 'Phone Number', 'Action']}
                rows={4}
                showPagination={true}
            />
        );
    }

    // Handle error state
    if (groupQuery.status === "error") {
        return (
            <div className="h-full flex flex-col justify-start overflow-hidden border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
                <div className="flex items-center justify-center h-full">
                    <div className="text-red-600">Error loading group members</div>
                </div>
            </div>
        );
    }

    function renderTableContent() {

        if (groupQuery.status === "error") {
            return (
                <TableRow>
                    <TableCell colSpan={4} className="text-center py-8 text-red-600 w-full">
                        Error loading group members. Please try again.
                    </TableCell>
                </TableRow>
            );
        }

        const members = groupQuery.data?.members || [];
        return members.map((member) => (
            <TableRow key={member.id} className="cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800">
                <TableCell className="w-1/4">{member.first_name}</TableCell>
                <TableCell className="w-1/4">{member.last_name}</TableCell>
                <TableCell className="w-1/3">
                    {member.phone
                        ? member.phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')
                        : '-'
                    }
                </TableCell>
                <TableCell className="w-1/6">
                    <Button
                        outline
                        onClick={() => handleRemoveMemberClick(
                            member.id,
                            `${member.first_name} ${member.last_name}`
                        )}
                        disabled={removeMembersMutation.isPending}
                        aria-label={`Remove ${member.first_name} ${member.last_name} from group`}
                    >
                        <TrashIcon className="h-4 w-4" />
                    </Button>
                </TableCell>
            </TableRow>
        ));
    }

    return (
        <div>
            {/* Pagination Controls and Add Button - Top */}
            <div className="flex items-center px-2 py-4 border-b border-zinc-950/10 dark:border-white/10 mb-4">
                {groupQuery.data && 'pagination' in groupQuery.data && groupQuery.data.pagination ? (
                    <div className="flex items-center justify-between flex-1 mr-4">
                        <div className="text-sm text-gray-700 dark:text-gray-300">
                            Showing {(groupQuery.data as any).pagination.total === 0 ? 0 : (((groupQuery.data as any).pagination.page - 1) * (groupQuery.data as any).pagination.limit) + 1} to{" "}
                            {Math.min((groupQuery.data as any).pagination.page * (groupQuery.data as any).pagination.limit, (groupQuery.data as any).pagination.total)} of{" "}
                            {(groupQuery.data as any).pagination.total} members
                        </div>
                        <div className="flex items-center space-x-2">
                            <Button
                                outline
                                onClick={() => setCurrentPage(prev => Math.max(1, prev - 1))}
                                disabled={groupQuery.isFetching || !(groupQuery.data as any).pagination.hasPrev}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm"
                            >
                                <ChevronLeftIcon className="h-4 w-4" />
                                Previous
                            </Button>

                            <div className="flex items-center space-x-1">
                                {/* Page numbers */}
                                {Array.from({ length: Math.min(5, (groupQuery.data as any).pagination.totalPages) }, (_, i) => {
                                    const pageNum = Math.max(1, Math.min(
                                        (groupQuery.data as any).pagination.totalPages - 4,
                                        (groupQuery.data as any).pagination.page - 2
                                    )) + i;

                                    if (pageNum > (groupQuery.data as any).pagination.totalPages) return null;

                                    return (
                                        <Button
                                            key={pageNum}
                                            {...(pageNum === (groupQuery.data as any).pagination.page ? { color: 'emerald' } : { outline: true })}
                                            onClick={() => setCurrentPage(pageNum)}
                                            disabled={groupQuery.isFetching}
                                            className="min-w-[2rem] px-2 py-1.5 text-sm"
                                        >
                                            {pageNum}
                                        </Button>
                                    );
                                })}
                            </div>

                            <Button
                                outline
                                onClick={() => setCurrentPage(prev => Math.min((groupQuery.data as any).pagination.totalPages, prev + 1))}
                                disabled={groupQuery.isFetching || !(groupQuery.data as any).pagination.hasNext}
                                className="flex items-center gap-1 px-3 py-1.5 text-sm"
                            >
                                Next
                                <ChevronRightIcon className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1 mr-4"></div>
                )}
                <Button
                    color="emerald"
                    onClick={() => setIsModalOpen(true)}
                >
                    <PlusIcon />
                </Button>
            </div>
            <AddContactsToGroupModal
                groupId={groupId}
                isOpen={isModalOpen}
                setIsOpen={setIsModalOpen}
            />
            <div className="relative">
                <Table dense>
                    <TableHead>
                        <TableRow>
                            <TableHeader className="w-1/4">First Name</TableHeader>
                            <TableHeader className="w-1/4">Last Name</TableHeader>
                            <TableHeader className="w-1/3">Phone Number</TableHeader>
                            <TableHeader className="w-1/6">Action</TableHeader>
                        </TableRow>
                    </TableHead>
                    <TableBody>{renderTableContent()}</TableBody>
                </Table>

                {/* Loading Overlay */}
                {groupQuery.isFetching && (
                    <div className="absolute inset-0 bg-white/80 dark:bg-zinc-900/80 flex items-center justify-center backdrop-blur-sm z-10">
                        <LoadingSpinner />
                    </div>
                )}
            </div>

            <Dialog
                open={isConfirmDialogOpen}
                onClose={handleCancelRemove}
                size="sm"
            >
                <DialogTitle>Remove Member</DialogTitle>
                <DialogDescription>
                    Are you sure you want to remove {memberToRemove?.name} from
                    this group? This action cannot be undone.
                </DialogDescription>
                <DialogBody>
                    <DialogActions>
                        <Button onClick={handleCancelRemove}>Cancel</Button>
                        <Button
                            onClick={handleConfirmRemove}
                            disabled={removeMembersMutation.isPending}
                            color="red"
                        >
                            {removeMembersMutation.isPending ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (
                                "Remove Member"
                            )}
                        </Button>
                    </DialogActions>
                </DialogBody>
            </Dialog>
        </div>
    );
}
