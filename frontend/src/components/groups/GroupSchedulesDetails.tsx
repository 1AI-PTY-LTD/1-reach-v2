import { Fragment, useState, useEffect } from 'react';
import GroupScheduleModal from './GroupScheduleModal';
import { Button } from '../../ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { useQuery } from '@tanstack/react-query';
import { getAllGroupSchedulesQueryOptions } from '../../api/groupSchedulesApi';
import type { GroupSchedule } from '../../types/groupSchedule.types';
import dayjs from 'dayjs';
import GroupScheduleChildrenList from './GroupScheduleChildrenList';
import { ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid';
import { PlusIcon } from '@heroicons/react/16/solid';
import LoadingSpinner from '../shared/LoadingSpinner';
import TableSkeleton from '../shared/TableSkeleton';
import Logger from '../../utils/logger';
import { useApiClient } from '../../lib/ApiClientProvider';

export default function GroupSchedulesDetails({ groupId }: { groupId: number }) {
	const client = useApiClient();
	const [isModalOpen, setIsModalOpen] = useState(false);
	const [expandedRow, setExpandedRow] = useState<number | null>(null);
	const [currentPage, setCurrentPage] = useState(1);
	const [pageSize] = useState(20);
	const [showLoader, setShowLoader] = useState(false);
	const [editingScheduleId, setEditingScheduleId] = useState<number | null>(null);

	const handleToggleRow = (groupScheduleId: number) => {
		if (expandedRow === groupScheduleId) {
			setExpandedRow(null);
		} else {
			setExpandedRow(groupScheduleId);
		}
	};

	const groupQuery = useQuery(getAllGroupSchedulesQueryOptions(client, undefined, groupId, currentPage, pageSize));

	const handleEditSchedule = (groupSchedule: GroupSchedule) => {
		Logger.info('Opening edit modal for group schedule', {
			component: 'GroupSchedulesDetails',
			data: { groupScheduleId: groupSchedule.id },
		});
		setEditingScheduleId(groupSchedule.id);
		setIsModalOpen(true);
	};

	// Handle loading spinner with minimum display time to prevent blinking
	useEffect(() => {
		if (groupQuery.isFetching) {
			setShowLoader(true);
		} else {
			const timer = setTimeout(() => {
				setShowLoader(false);
			}, 150); // Minimum 150 display time
			return () => clearTimeout(timer);
		}
	}, [groupQuery.isFetching]);

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

	const renderedGroupSchedules = groupQuery?.data?.results?.map((groupSchedule) => {
		const isExpanded = expandedRow === groupSchedule.id;

		// Calculate sent/total message counts
		const totalMessages = groupSchedule.child_count;
		const sentMessages =
			groupSchedule.schedules?.filter(
				(schedule) => schedule.status === 'sent' || schedule.status === 'delivered'
			).length || 0;

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
						<span className="text-sm font-medium">
							{sentMessages}/{totalMessages}
						</span>
					</TableCell>
				</TableRow>
				{isExpanded && <GroupScheduleChildrenList groupScheduleId={groupSchedule.id} onEdit={handleEditSchedule} />}
			</Fragment>
		);
	});

	return (
		<div className="h-full flex flex-col">
			{/* Pagination Controls and Add Button - Top */}
			<div className="px-2 py-2 border-b border-zinc-950/10 dark:border-white/10 mb-2 flex-shrink-0">
				{groupQuery?.data?.pagination ? (
					<div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 mb-1">
						<div className="text-sm text-gray-700 dark:text-gray-300 flex-shrink-0 min-w-0">
							<span className="whitespace-nowrap">
								Showing{' '}
								{groupQuery.data.pagination.total === 0
									? 0
									: (groupQuery.data.pagination.page - 1) * groupQuery.data.pagination.limit + 1}{' '}
								to{' '}
								{Math.min(
									groupQuery.data.pagination.page * groupQuery.data.pagination.limit,
									groupQuery.data.pagination.total
								)}{' '}
								of {groupQuery.data.pagination.total} results
							</span>
						</div>
						{showLoader && <LoadingSpinner />}
						<div className="flex items-center space-x-1 flex-wrap gap-1 min-w-0">
							<Button
								outline
								onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
								disabled={groupQuery.isFetching || !groupQuery.data.pagination.hasPrev}
								className="flex items-center gap-1 px-3 py-1.5 text-sm"
							>
								<ChevronLeftIcon className="h-4 w-4" />
								Previous
							</Button>

							<div className="flex items-center space-x-1">
								{/* Page numbers */}
								{Array.from({ length: Math.min(5, groupQuery.data.pagination.totalPages) }, (_, i) => {
									const pageNum =
										Math.max(
											1,
											Math.min(
												groupQuery.data.pagination.totalPages - 4,
												groupQuery.data.pagination.page - 2
											)
										) + i;

									if (pageNum > groupQuery.data.pagination.totalPages) return null;

									return (
										<Button
											key={pageNum}
											{...(pageNum === groupQuery.data.pagination.page
												? { color: 'emerald' }
												: { outline: true })}
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
								onClick={() =>
									setCurrentPage((prev) => Math.min(groupQuery.data.pagination.totalPages, prev + 1))
								}
								disabled={groupQuery.isFetching || !groupQuery.data.pagination.hasNext}
								className="flex items-center gap-1 px-3 py-1.5 text-sm"
							>
								Next
								<ChevronRightIcon className="h-4 w-4" />
							</Button>
							<Button
								color="emerald"
								onClick={() => setIsModalOpen(true)}
							>
								<PlusIcon />
							</Button>
						</div>
					</div>
				) : null}
			</div>

			<div className="flex-1 min-h-0 overflow-auto relative">
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

