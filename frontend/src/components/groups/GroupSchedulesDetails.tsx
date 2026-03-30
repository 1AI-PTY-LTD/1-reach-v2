import { Fragment, useState, useRef } from 'react';
import GroupScheduleModal from './GroupScheduleModal';
import { Button } from '../../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { useInfiniteQuery } from '@tanstack/react-query';
import { getGroupSchedulesInfiniteOptions } from '../../api/groupSchedulesApi';
import type { GroupSchedule } from '../../types/groupSchedule.types';
import dayjs from 'dayjs';
import GroupScheduleChildrenList from './GroupScheduleChildrenList';
import { StatusBadge } from '../StatusBadge';
import type { ScheduleStatus } from '../../types/schedule.types';
import { ChevronDownIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { PlusIcon } from '@heroicons/react/16/solid';
import LoadingSpinner from '../shared/LoadingSpinner';
import TableSkeleton from '../shared/TableSkeleton';
import Logger from '../../utils/logger';
import { useApiClient } from '../../lib/ApiClientProvider';
import { useInfiniteScroll } from '../../hooks/useInfiniteScroll';

export default function GroupSchedulesDetails({ groupId }: { groupId: number }) {
	const client = useApiClient();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [expandedRow, setExpandedRow] = useState<number | null>(null);
	const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);
	const scrollContainerRef = useRef<HTMLDivElement>(null);

	const handleToggleRow = (groupScheduleId: number) => {
		if (expandedRow === groupScheduleId) {
			setExpandedRow(null);
		} else {
			setExpandedRow(groupScheduleId);
		}
	};

	const groupQuery = useInfiniteQuery(getGroupSchedulesInfiniteOptions(client, groupId, 20));

	const sentinelRef = useInfiniteScroll({
		scrollContainerRef,
		hasNextPage: groupQuery.hasNextPage,
		isFetchingNextPage: groupQuery.isFetchingNextPage,
		fetchNextPage: groupQuery.fetchNextPage,
	});

	const handleEditSchedule = (groupSchedule: GroupSchedule) => {
		Logger.info('Opening edit modal for group schedule', {
			component: 'GroupSchedulesDetails',
			data: { groupScheduleId: groupSchedule.id },
		});
		setEditingScheduleId(groupSchedule.id);
		setIsModalOpen(true);
	};

	// Show skeleton loading while data is loading
	if (groupQuery.status === 'pending') {
		return (
			<TableSkeleton 
				columns={['Message', 'Scheduled For', 'Status']} 
				rows={5}
				showPagination={true}
			/>
		);
	}

	// Handle error state
	if (groupQuery.status === 'error') {
		return (
			<div className="h-full flex flex-col justify-start overflow-hidden border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
				<div className="flex items-center justify-center h-full">
					<div className="text-red-600">Error loading group schedules</div>
				</div>
			</div>
		);
	}

	const allGroupSchedules = groupQuery.data?.pages.flatMap((page) => page.results) ?? [];
	const totalCount = groupQuery.data?.pages[0]?.pagination.total ?? 0;

	const renderedGroupSchedules = allGroupSchedules.map((groupSchedule) => {
		const isExpanded = expandedRow === groupSchedule.id;

		const scheduleText = groupSchedule.text || groupSchedule.name;

		return (
			<Fragment key={groupSchedule.id}>
				<TableRow
					className={`cursor-pointer hover:bg-gray-50 dark:hover:bg-zinc-800 ${isExpanded ? 'bg-gray-50 dark:bg-zinc-800/50' : ''}`}
				>
					<TableCell onClick={() => handleToggleRow(groupSchedule.id)}>
						<div className="flex items-center gap-2">
							{isExpanded ? (
								<ChevronDownIcon className="h-4 w-4" />
							) : (
								<ChevronRightIcon className="h-4 w-4" />
							)}
							<div
								className="max-w-[300px] overflow-hidden text-ellipsis whitespace-nowrap"
								title={scheduleText}
							>
								{scheduleText}
							</div>
						</div>
					</TableCell>
					<TableCell onClick={() => handleToggleRow(groupSchedule.id)}>
						{dayjs(groupSchedule.scheduled_time).format('hh:mmA DD/MM/YYYY')}
					</TableCell>
					<TableCell onClick={() => handleToggleRow(groupSchedule.id)}>
						<StatusBadge status={groupSchedule.status as ScheduleStatus} />
					</TableCell>
				</TableRow>
				{isExpanded && <GroupScheduleChildrenList groupScheduleId={groupSchedule.id} onEdit={handleEditSchedule} />}
			</Fragment>
		);
	});

	return (
		<div className="h-full flex flex-col">
			{/* Header with count and Add button */}
			<div className="px-2 py-2 border-b border-zinc-950/10 dark:border-white/10 mb-2 flex-shrink-0">
				<div className="flex items-center justify-between">
					{totalCount > 0 && (
						<div className="text-sm text-gray-700 dark:text-gray-300">
							Showing {allGroupSchedules.length} of {totalCount} results
						</div>
					)}
					<Button
						color="emerald"
						onClick={() => setIsModalOpen(true)}
					>
						<PlusIcon />
					</Button>
				</div>
			</div>

			<div className="flex-1 min-h-0 overflow-auto relative" ref={scrollContainerRef}>
				<Table className="w-full table-fixed">
					<TableHead>
						<TableRow>
							<TableHeader className="w-1/2">Message</TableHeader>
							<TableHeader className="w-1/3">Scheduled For</TableHeader>
							<TableHeader className="w-1/6">Status</TableHeader>
						</TableRow>
					</TableHead>
					<TableBody>{renderedGroupSchedules}</TableBody>
				</Table>
				<div ref={sentinelRef} className="h-1" />
				{groupQuery.isFetchingNextPage && (
					<div className="flex justify-center py-4">
						<LoadingSpinner />
					</div>
				)}
			</div>
			<GroupScheduleModal 
				groupId={groupId} 
				groupScheduleId={editingScheduleId || undefined}
				isOpen={isModalOpen} 
				setIsOpen={(open) => {
					setIsModalOpen(open);
					if (!open) {
						setEditingScheduleId(null);
					}
				}} 
			/>
		</div>
	);
}

