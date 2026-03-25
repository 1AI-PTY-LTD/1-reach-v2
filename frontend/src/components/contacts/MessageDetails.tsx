import { Button } from '../../ui/button';
import { PencilIcon, TrashIcon } from '@heroicons/react/16/solid';
import dayjs from 'dayjs';
import type { Schedule } from '../../types/schedule.types';
import { ContactMessageModal } from './CustomerMessageModal';
import { useState } from 'react';
import Logger from '../../utils/logger';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '../../ui/table';
import { Alert, AlertActions, AlertDescription, AlertTitle } from '../../ui/alert';
import { useUpdateScheduleMutation } from '../../api/schedulesApi';
import { useApiClient } from '../../lib/ApiClientProvider';

export function MessageDetails({ message }: { message: Schedule }) {
	const client = useApiClient();

	Logger.debug('Rendering MessageDetails', {
		component: 'MessageDetails',
		data: {
			messageId: message.id,
			status: message.status,
			scheduled_time: message.scheduled_time,
		},
	});

	const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
	const [isAlertOpen, setIsAlertOpen] = useState<boolean>(false);
	const updateScheduleMutation = useUpdateScheduleMutation(client);

	const handleEdit = () => {
		Logger.info('Opening edit message modal', {
			component: 'MessageDetails',
			data: { messageId: message.id },
		});
		setIsModalOpen(true);
	};

	const handleDelete = async () => {
		Logger.warn('Message deletion requested', {
			component: 'MessageDetails',
			data: { messageId: message.id },
		});

		try {
			await updateScheduleMutation.mutateAsync({
				id: message.id,
				contact_id: message.contact ?? undefined,
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

	return (
		<div className="space-y-4 p-4">
			<Table>
				<TableHead>
					<TableRow>
						<TableHeader>Message</TableHeader>
					</TableRow>
				</TableHead>
				<TableBody>
					<TableRow>
						<TableCell className="whitespace-pre-wrap break-words max-w-0">{message.text}</TableCell>
					</TableRow>
				</TableBody>
			</Table>
			{message.status === 'pending' && dayjs(message.scheduled_time).isAfter(dayjs()) && (
				<div className="flex justify-between">
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
				contact={{
					id: message.contact!,
					first_name: '',
					last_name: '',
					phone: message.phone || '',
					is_active: true,
					opt_out: false,
					created_at: '',
					updated_at: '',
				}}
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
						disabled={updateScheduleMutation.isPending}
					>
						{updateScheduleMutation.isPending ? (
							<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
						) : (
							<>
								<TrashIcon />
								Delete
							</>
						)}
					</Button>
				</AlertActions>
			</Alert>
		</div>
	);
}
