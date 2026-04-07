import dayjs from 'dayjs';
import { Divider } from '../ui/divider';
import { Button } from '../ui/button';
import { ArrowPathIcon, PencilIcon, XMarkIcon } from '@heroicons/react/16/solid';
import type { Contact } from '../types/contact.types';
import type { Schedule } from '../types/schedule.types';
import { ContactMessageModal } from './contacts/CustomerMessageModal';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import Logger from '../utils/logger';
import { Alert, AlertActions, AlertDescription, AlertTitle } from '../ui/alert';
import { useCancelScheduleMutation, useRetryScheduleMutation, getScheduleRecipientsQueryOptions } from '../api/schedulesApi';
import { useApiClient } from '../lib/ApiClientProvider';
import { useQuery } from '@tanstack/react-query';
import { StatusBadge } from './StatusBadge';

function RecipientsTable({ parentId }: { parentId: number }) {
	const client = useApiClient();
	const { data: recipients, isLoading } = useQuery(getScheduleRecipientsQueryOptions(client, parentId));

	if (isLoading) {
		return (
			<div className="flex items-center gap-2 py-3 px-4 text-sm text-zinc-500 dark:text-zinc-400">
				<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
				Loading recipients...
			</div>
		);
	}

	if (!recipients?.length) return null;

	return (
		<Table>
			<TableHead>
				<TableRow>
					<TableHeader>Name</TableHeader>
					<TableHeader>Phone</TableHeader>
					<TableHeader>Status</TableHeader>
					<TableHeader>Error</TableHeader>
				</TableRow>
			</TableHead>
			<TableBody>
				{recipients.map((r) => (
					<TableRow key={r.id}>
						<TableCell>
							{r.contact_detail
								? `${r.contact_detail.first_name} ${r.contact_detail.last_name}`
								: '-'}
						</TableCell>
						<TableCell>
							{r.phone?.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3') || '-'}
						</TableCell>
						<TableCell>
							<StatusBadge status={r.status} />
						</TableCell>
						<TableCell className="text-sm text-zinc-500 dark:text-zinc-400">
							{r.error || '-'}
						</TableCell>
					</TableRow>
				))}
			</TableBody>
		</Table>
	);
}

export function ScheduleDetails({ message }: { message: Schedule | undefined }) {
	Logger.debug('Rendering ScheduleDetails', {
		component: 'ScheduleDetails',
		data: {
			messageId: message?.id,
			messageStatus: message?.status,
			contactId: message?.contact,
			firstName: message?.contact_detail?.first_name,
			lastName: message?.contact_detail?.last_name,
			customerPhone: message?.contact_detail?.phone || message?.phone,
		},
	});

	const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
	const [isAlertOpen, setIsAlertOpen] = useState<boolean>(false);
	const [isRetryAlertOpen, setIsRetryAlertOpen] = useState<boolean>(false);
	const client = useApiClient();
	const cancelMutation = useCancelScheduleMutation(client);
	const retryMutation = useRetryScheduleMutation(client);

	if (!message) {
		Logger.debug('No message data', {
			component: 'ScheduleDetails',
			data: {
				hasMessage: !!message,
			},
		});
		return <></>;
	}

	const handleEdit = () => {
		Logger.info('Opening edit message modal', {
			component: 'ScheduleDetails',
			data: {
				messageId: message.id,
			},
		});
		setIsModalOpen(true);
	};

	const handleCancel = async () => {
		Logger.warn('Message cancellation requested', {
			component: 'ScheduleDetails',
			data: {
				messageId: message.id,
				scheduledTime: message.scheduled_time,
			},
		});

		try {
			await cancelMutation.mutateAsync(message.id);
			Logger.info('Message cancelled successfully', {
				component: 'ScheduleDetails',
				data: { messageId: message.id },
			});
		} catch (error) {
			Logger.error('Failed to cancel message', {
				component: 'ScheduleDetails',
				data: { messageId: message.id, error },
			});
			throw error;
		}
	};

	const handleRetry = async () => {
		Logger.info('Message retry requested', {
			component: 'ScheduleDetails',
			data: { messageId: message.id },
		});

		try {
			await retryMutation.mutateAsync(message.id);
			Logger.info('Message retry initiated', {
				component: 'ScheduleDetails',
				data: { messageId: message.id },
			});
		} catch (error) {
			Logger.error('Failed to retry message', {
				component: 'ScheduleDetails',
				data: { messageId: message.id, error },
			});
			throw error;
		}
	};

	const canCancel = message.status === 'pending';
	const canEdit = message.status === 'pending' && dayjs(message.scheduled_time).isAfter(dayjs());
	const canRetry = message.status === 'failed';
	const isBatchParent = (message.recipient_count ?? 0) > 0;

	return (
		<div className="">
			<Table>
				<TableHead>
					<TableRow>
						<TableHeader>Message</TableHeader>
					</TableRow>
				</TableHead>
				<TableBody>
					<TableRow>
						<TableCell className="whitespace-pre-wrap break-words max-w-xs">{message.text}</TableCell>
					</TableRow>
				</TableBody>
			</Table>
			{isBatchParent && (
				<>
					<Divider />
					<RecipientsTable parentId={message.id} />
				</>
			)}
			<Divider />
			{(canCancel || canEdit || canRetry) && (
				<div className="flex justify-between mt-4">
					{canCancel && (
						<Button color="red" onClick={() => setIsAlertOpen(true)}>
							<XMarkIcon />
							Cancel
						</Button>
					)}
					{canRetry && (
						<Button color="amber" onClick={() => setIsRetryAlertOpen(true)}>
							<ArrowPathIcon />
							Retry
						</Button>
					)}
					{canEdit && (
						<Button color="emerald" onClick={handleEdit} className="ml-auto">
							<PencilIcon />
							Edit
						</Button>
					)}
				</div>
			)}
			{isModalOpen && <ContactMessageModal
				contact={{
					id: message.contact!,
					first_name: message.contact_detail?.first_name || '',
					last_name: message.contact_detail?.last_name || '',
					phone: message.contact_detail?.phone || message.phone || ''
				} as Contact}
				message={message}
				isOpen={isModalOpen}
				setIsOpen={setIsModalOpen}
			/>}
			<Alert open={isAlertOpen} onClose={() => setIsAlertOpen(false)}>
				<AlertTitle>Are you sure you want to cancel this message?</AlertTitle>
				<AlertDescription>The message will be cancelled and will not be sent.</AlertDescription>
				<AlertActions>
					<Button plain onClick={() => setIsAlertOpen(false)}>
						No, keep it
					</Button>
					<Button
						color="red"
						onClick={async () => {
							await handleCancel();
							setIsAlertOpen(false);
						}}
						disabled={cancelMutation.isPending}
					>
						{cancelMutation.isPending ? (
							<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
						) : (
							<>
								<XMarkIcon />
								Yes, cancel
							</>
						)}
					</Button>
				</AlertActions>
			</Alert>
			<Alert open={isRetryAlertOpen} onClose={() => setIsRetryAlertOpen(false)}>
				<AlertTitle>Retry this message?</AlertTitle>
				<AlertDescription>The message will be re-queued for delivery.</AlertDescription>
				<AlertActions>
					<Button plain onClick={() => setIsRetryAlertOpen(false)}>
						No, keep it
					</Button>
					<Button
						color="amber"
						onClick={async () => {
							await handleRetry();
							setIsRetryAlertOpen(false);
						}}
						disabled={retryMutation.isPending}
					>
						{retryMutation.isPending ? (
							<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
						) : (
							<>
								<ArrowPathIcon />
								Yes, retry
							</>
						)}
					</Button>
				</AlertActions>
			</Alert>
		</div>
	);
}
