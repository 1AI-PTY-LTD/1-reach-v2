import { Fragment, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { getGroupScheduleByIdQueryOptions, useDeleteGroupScheduleMutation } from '../../api/groupSchedulesApi';
import { Text } from '../../ui/text';
import { StatusBadge } from '../StatusBadge';
import type { ScheduleStatus } from '../../types/schedule.types';
import LoadingSpinner from '../shared/LoadingSpinner';
import dayjs from 'dayjs';
import { Button } from '../../ui/button';
import { PencilIcon, TrashIcon } from '@heroicons/react/16/solid';
import { Alert, AlertActions, AlertDescription, AlertTitle } from '../../ui/alert';
import Logger from '../../utils/logger';
import { useApiClient } from '../../lib/ApiClientProvider';

interface GroupScheduleChildrenListProps {
	groupScheduleId: number;
	onEdit?: (groupSchedule: any) => void;
}

export default function GroupScheduleChildrenList({ groupScheduleId, onEdit }: GroupScheduleChildrenListProps) {
	const client = useApiClient();
	const groupScheduleListQuery = useQuery(getGroupScheduleByIdQueryOptions(client, groupScheduleId));
	const [isAlertOpen, setIsAlertOpen] = useState<boolean>(false);
	const deleteGroupScheduleMutation = useDeleteGroupScheduleMutation(client);

	// Handle loading state with proper table row structure
	if (groupScheduleListQuery.isPending) {
		return (
			<TableRow className="bg-gray-50 dark:bg-zinc-800/50">
				<TableCell colSpan={3} className="pl-8 text-sm text-gray-500 dark:text-gray-400">
					<LoadingSpinner />
				</TableCell>
			</TableRow>
		);
	}

	// Handle error state
	if (groupScheduleListQuery.isError) {
		return (
			<TableRow className="bg-gray-50 dark:bg-zinc-800/50">
				<TableCell colSpan={3} className="pl-8 text-sm text-red-500">
					Error loading individual schedules
				</TableCell>
			</TableRow>
		);
	}

	const groupScheduleData = groupScheduleListQuery.data;

	if (!groupScheduleData?.schedules || groupScheduleData.schedules.length === 0) {
		return (
			<TableRow className="bg-gray-50 dark:bg-zinc-800/50">
				<TableCell colSpan={3} className="pl-8 text-sm text-gray-500 dark:text-gray-400">
					No individual schedules found
				</TableCell>
			</TableRow>
		);
	}

	const handleEdit = () => {
		Logger.info('Opening edit group schedule modal', {
			component: 'GroupScheduleChildrenList',
			data: { groupScheduleId },
		});
		if (onEdit) {
			onEdit(groupScheduleData);
		}
	};

	const handleDelete = async () => {
		Logger.warn('Group schedule deletion requested', {
			component: 'GroupScheduleChildrenList',
			data: { groupScheduleId },
		});

		try {
			await deleteGroupScheduleMutation.mutateAsync(groupScheduleId);
			Logger.info('Group schedule deleted successfully', {
				component: 'GroupScheduleChildrenList',
				data: { groupScheduleId },
			});
		} catch (error) {
			Logger.error('Failed to delete group schedule', {
				component: 'GroupScheduleChildrenList',
				data: { groupScheduleId, error },
			});
			throw error;
		}
	};

	// Check if this group schedule can be edited/deleted
	const canModify = groupScheduleData.status === 'pending' &&
		dayjs(groupScheduleData.scheduled_time).isAfter(dayjs());

	// Render individual schedules in a nested table, similar to MessageDetails.tsx
	return (
		<Fragment>
			<TableRow className="bg-gray-50 dark:bg-zinc-800/50">
				<TableCell colSpan={3} className="space-y-4 p-4">
					<Table>
						<TableHead>
							<TableRow>
								<TableHeader>Message</TableHeader>
							</TableRow>
						</TableHead>
						<TableBody>
							<TableRow>
								<TableCell className="max-w-0 break-words whitespace-pre-wrap">
									{groupScheduleData.text}
								</TableCell>
							</TableRow>
						</TableBody>
					</Table>
					<Table>
						<TableHead>
							<TableRow>
								<TableHeader>Status</TableHeader>
								<TableHeader>Contact</TableHeader>
								<TableHeader>Scheduled Time</TableHeader>
								<TableHeader>Sent Time</TableHeader>
							</TableRow>
						</TableHead>
						<TableBody>
							{groupScheduleData.schedules.map((schedule) => (
								<TableRow key={`individual-${schedule.id}`} className="border-b-0">
									<TableCell className="text-sm">
										<StatusBadge status={schedule.status as ScheduleStatus} />
									</TableCell>
									<TableCell className="text-sm text-gray-600 dark:text-gray-400">
										{schedule.contact ? `${schedule.contact.first_name} ${schedule.contact.last_name}` : 'Unknown Contact'}
									</TableCell>
									<TableCell className="text-sm text-gray-600 dark:text-gray-400">
										{dayjs(schedule.scheduled_time).format('hh:mmA DD/MM/YYYY')}
									</TableCell>
									<TableCell className="text-sm text-gray-600 dark:text-gray-400">
										{schedule.sent_time ? dayjs(schedule.sent_time).format('hh:mmA DD/MM/YYYY') : 'N/A'}
									</TableCell>
								</TableRow>
							))}
						</TableBody>
					</Table>
					{canModify && (
						<div className="flex justify-between mt-4">
							<Button color="red" onClick={() => setIsAlertOpen(true)}>
								<TrashIcon />
								Remove
							</Button>
							<Button color="emerald" onClick={handleEdit}>
								<PencilIcon />
								Edit
							</Button>
						</div>
					)}
				</TableCell>
			</TableRow>
			{isAlertOpen && (
				<TableRow>
					<TableCell colSpan={3}>
						<Alert open={isAlertOpen} onClose={() => setIsAlertOpen(false)}>
							<AlertTitle>Are you sure you want to delete this group schedule?</AlertTitle>
							<AlertDescription>The group schedule and all individual messages will be removed from the list.</AlertDescription>
							<AlertActions>
								<Button plain onClick={() => setIsAlertOpen(false)}>
									Cancel
								</Button>
								<Button
									color="red"
									onClick={async () => {
										await handleDelete();
										setIsAlertOpen(false);
									}}
									disabled={deleteGroupScheduleMutation.isPending}
								>
									{deleteGroupScheduleMutation.isPending ? (
										<div className="flex items-center gap-2">
											<div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
											Deleting...
										</div>
									) : (
										<>
											<TrashIcon />
											Delete
										</>
									)}
								</Button>
							</AlertActions>
						</Alert>
					</TableCell>
				</TableRow>
			)}
		</Fragment>
	);
}
