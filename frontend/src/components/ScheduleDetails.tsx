import dayjs from 'dayjs';
import { Divider } from '../ui/divider';
import { Button } from '../ui/button';
import { PencilIcon, XMarkIcon } from '@heroicons/react/16/solid';
import type { Contact } from '../types/contact.types';
import type { Schedule } from '../types/schedule.types';
import { ContactMessageModal } from './contacts/CustomerMessageModal';
import { useState } from 'react';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../ui/table';
import Logger from '../utils/logger';
import { Alert, AlertActions, AlertDescription, AlertTitle } from '../ui/alert';
import { useCancelScheduleMutation } from '../api/schedulesApi';
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
	const cancelMutation = useCancelScheduleMutation(client);

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

	const canCancel = message.status === 'pending';
	const canEdit = message.status === 'pending' && dayjs(message.scheduled_time).isAfter(dayjs());

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
			{(canCancel || canEdit) && (
				<div className="flex justify-between mt-4">
					{canCancel && (
						<Button color="red" onClick={() => setIsAlertOpen(true)}>
							<XMarkIcon />
							Cancel
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
		</div>
	);
}
