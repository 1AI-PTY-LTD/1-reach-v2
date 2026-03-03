import dayjs from 'dayjs';
import { StatusBadge } from './StatusBadge';
import { Divider } from '../ui/divider';
import { Button } from '../ui/button';
import { PencilIcon, TrashIcon } from '@heroicons/react/16/solid';
import type { Contact } from '../types/contact.types';
import type { Schedule } from '../types/schedule.types';
import { ContactMessageModal } from './contacts/CustomerMessageModal';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import Logger from '../utils/logger';
import { Alert, AlertActions, AlertDescription, AlertTitle } from '../ui/alert';
import { useUpdateScheduleMutation } from '../api/schedulesApi';
import { useApiClient } from '../lib/ApiClientProvider';

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
	const client = useApiClient();
	const updateScheduleMutation = useUpdateScheduleMutation(client);

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

	const handleDelete = async () => {
		Logger.warn('Message deletion requested', {
			component: 'ScheduleDetails',
			data: {
				messageId: message.id,
				scheduledTime: message.scheduled_time,
			},
		});

		try {
			await updateScheduleMutation.mutateAsync({
				id: message.id,
				text: message.text || undefined,
				contact_id: message.contact || undefined,
				scheduled_time: message.scheduled_time,
			});
			Logger.info('Message deleted successfully', {
				component: 'MessageDetails',
				data: { messageId: message.id },
			});
		} catch (error) {
			Logger.error('Failed to delete message', {
				component: 'MessageDetails',
				data: { messageId: message.id, error },
			});
			throw error;
		}
	};

	const canEdit = dayjs(message.scheduled_time).isAfter(dayjs());
	Logger.debug('Checking edit permissions', {
		component: 'ScheduleDetails',
		data: {
			canEdit,
			scheduledTime: message.scheduled_time,
		},
	});

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
			<Divider />
			{canEdit && (
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
			<ContactMessageModal
				customer={{
					id: message.contact!,
					first_name: message.contact_detail?.first_name || '',
					last_name: message.contact_detail?.last_name || '',
					phone: message.contact_detail?.phone || message.phone || ''
				} as Contact}
				message={message}
				isOpen={isModalOpen}
				setIsOpen={setIsModalOpen}
			/>
			<Alert open={isAlertOpen} onClose={() => setIsAlertOpen(false)}>
				<AlertTitle>Are you sure you want to delete this message?</AlertTitle>
				<AlertDescription>The message will be removed from the list of messages.</AlertDescription>
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
					>
						<TrashIcon />
						Delete
					</Button>
				</AlertActions>
			</Alert>
		</div>
	);
}
