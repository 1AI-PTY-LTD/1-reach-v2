import { Field, Label } from '../ui/fieldset';
import { Input } from '../ui/input';
import dayjs from 'dayjs';
import Logger from '../utils/logger';

export function isTimeInPast(isoString: string): boolean {
	return dayjs(isoString).isBefore(dayjs());
}

export function shouldSendImmediately(isoString: string): boolean {
	const scheduled = dayjs(isoString);
	const now = dayjs();
	const minDelayFromNow = now.add(Number(import.meta.env.VITE_MIN_MESSAGE_DELAY || 5), 'minute');
	return scheduled.isBefore(minDelayFromNow) || scheduled.isBefore(now);
}

interface ScheduleDateTimePickerProps {
	value: string;
	onChange: (isoString: string) => void;
	showStatus?: boolean;
}

export function ScheduleDateTimePicker({
	value,
	onChange,
	showStatus = true,
}: ScheduleDateTimePickerProps) {
	const displayValue = value
		? dayjs(value).format('YYYY-MM-DDTHH:mm')
		: '';

	const minValue = dayjs().format('YYYY-MM-DDTHH:mm');

	const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
		const localValue = e.target.value;
		if (!localValue) {
			onChange('');
			return;
		}
		const isoString = new Date(localValue).toISOString();
		Logger.debug('Schedule datetime changed', {
			component: 'ScheduleDateTimePicker',
			data: { localValue, isoString },
		});
		onChange(isoString);
	};

	const isPast = value ? isTimeInPast(value) : false;
	const isImmediate = value ? shouldSendImmediately(value) : false;

	return (
		<Field>
			<Label>Scheduled Time *</Label>
			<Input
				type="datetime-local"
				value={displayValue}
				min={minValue}
				onChange={handleChange}
			/>
			{showStatus && value && (
				<div className={`text-sm mt-1 p-2 rounded ${
					isPast
						? 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 border border-red-200 dark:border-red-800'
						: isImmediate
							? 'bg-orange-50 dark:bg-orange-950/20 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-800'
							: 'bg-blue-50 dark:bg-blue-950/20 text-blue-700 dark:text-blue-400 border border-blue-200 dark:border-blue-800'
				}`}>
					{isPast
						? "A message can't be scheduled for a time in the past!"
						: isImmediate
							? `This message will be sent immediately (scheduled time is within ${import.meta.env.VITE_MIN_MESSAGE_DELAY || 5} minutes)`
							: 'This message will be scheduled for future delivery'
					}
				</div>
			)}
		</Field>
	);
}
