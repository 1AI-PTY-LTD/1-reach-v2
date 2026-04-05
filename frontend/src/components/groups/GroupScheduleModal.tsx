import { Dialog, DialogActions, DialogBody, DialogTitle } from '../../ui/dialog';
import { Field, Label } from '../../ui/fieldset';
import { Button } from '../../ui/button';
import { useForm } from '@tanstack/react-form';
import Logger from '../../utils/logger';
import { Textarea } from '../../ui/textarea';
import { useEffect, useState } from 'react';
import { useCreateGroupScheduleMutation, useUpdateGroupScheduleMutation, getGroupScheduleByIdQueryOptions } from '../../api/groupSchedulesApi';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getAllTemplatesQueryOptions } from '../../api/templatesApi';
import { Select } from '../../ui/select';
import dayjs from 'dayjs';
import { sendSmsToGroup } from '../../api/smsApi';
import type { SendGroupSmsRequest } from '../../types/sms.types';
import { useApiClient } from '../../lib/ApiClientProvider';
import { toast } from 'sonner';
import { ScheduleDateTimePicker, isTimeInPast, shouldSendImmediately } from '../ScheduleDateTimePicker';

export default function GroupScheduleModal({
	groupId,
	groupScheduleId,
	isOpen,
	setIsOpen,
}: {
	groupId: number;
	groupScheduleId?: number;
	isOpen: boolean;
	setIsOpen: (value: boolean) => void;
}) {
	const client = useApiClient();
	const queryClient = useQueryClient();
	const createNewGroupSchedule = useCreateGroupScheduleMutation(client);
	const updateGroupSchedule = useUpdateGroupScheduleMutation(client);
	const isEditMode = !!groupScheduleId;
	const [isSubmitting, setIsSubmitting] = useState(false);
	const [errorMessage, setErrorMessage] = useState<string>("");

	// Helper function to determine if message should be sent immediately
	// Helper function to extract error message from API response
	const extractErrorMessage = (error: any): string => {
		if (error?.response?.data?.error) {
			return error.response.data.error;
		}
		if (error?.response?.data?.message) {
			return error.response.data.message;
		}
		if (error?.message) {
			return error.message;
		}
		return "An unexpected error occurred. Please try again.";
	};

	// Load existing group schedule data if editing
	const { data: existingGroupSchedule, isLoading: isLoadingGroupSchedule } = useQuery({
		...getGroupScheduleByIdQueryOptions(client, groupScheduleId!),
		enabled: isEditMode && isOpen,
	});

	// Load templates for dropdown
	const { data: templates, isLoading: isLoadingTemplates } = useQuery({
		...getAllTemplatesQueryOptions(client),
		enabled: isOpen,
	});

	const form = useForm({
		defaultValues: {
			template_id: '',
			text: '',
			scheduled_time: '',
		},
		onSubmit: async ({ value }) => {
			setIsSubmitting(true);
			setErrorMessage(""); // Clear any previous errors

			Logger.debug('Submit group schedule form data', {
				component: 'GroupScheduleModal',
				data: {
					template_id: value.template_id,
					text: value.text,
					groupId,
					scheduled_time: value.scheduled_time,
					isEditMode,
					groupScheduleId,
					shouldSendImmediately: shouldSendImmediately(value.scheduled_time)
				},
			});

			try {
				// Validate required fields
				if (!value.scheduled_time) {
					Logger.warn('Scheduled time is required', { component: 'GroupScheduleModal' });
					return;
				}

				if (!value.template_id && !value.text.trim()) {
					Logger.warn('Either template or text is required', { component: 'GroupScheduleModal' });
					return;
				}

				// Always use the edited text content
				const messageText = value.text.trim();

				if (isEditMode && groupScheduleId) {
					// Update existing group schedule
					Logger.info('Updating group schedule', {
						component: 'GroupScheduleModal',
						data: { groupScheduleId, messageText, scheduled_time: value.scheduled_time },
					});

					const updateData: any = {
						id: groupScheduleId,
						scheduled_time: value.scheduled_time,
					};

					// Add message content with mutual exclusivity
					if (value.template_id) {
						updateData.template_id = parseInt(value.template_id);
						updateData.text = null; // Clear custom text when using template
					} else {
						updateData.text = messageText;
						updateData.template_id = null; // Clear template when using custom text
						// Generate new name from custom text
						updateData.name = messageText.substring(0, 20).trim() || 'Untitled Message';
					}

					await new Promise((resolve, reject) => {
						updateGroupSchedule.mutate(updateData, {
							onSuccess: resolve,
							onError: reject
						});
					});

					Logger.info('Group schedule updated successfully', {
						component: 'GroupScheduleModal',
						data: { groupScheduleId },
					});
				} else {
					if (shouldSendImmediately(value.scheduled_time)) {
						// Send immediate group message
						Logger.info('Sending immediate group message', {
							component: 'GroupScheduleModal',
							data: { groupId }
						});

						const smsProps: SendGroupSmsRequest = {
							group_id: groupId,
							message: messageText
						};

						await sendSmsToGroup(client, smsProps);

						Logger.info('Immediate group message sent successfully', {
							component: 'GroupScheduleModal',
							data: { groupId }
						});

						// Manually invalidate queries since we bypassed the mutation
						queryClient.invalidateQueries({
							queryKey: ['group-schedules'],
							refetchType: 'active',
						});
					} else {
						// Create scheduled group message
						Logger.info('Creating scheduled group message', {
							component: 'GroupScheduleModal',
							data: { groupId }
						});

						const generatedName = messageText.substring(0, 20).trim() || 'Untitled Message';

						const submissionData = {
							name: generatedName,
							group_id: groupId,
							scheduled_time: value.scheduled_time,
							...(value.template_id ? { template_id: parseInt(value.template_id) } : {}),
							...(value.text.trim() ? { text: value.text.trim() } : {}),
						};

						await new Promise((resolve, reject) => {
							createNewGroupSchedule.mutate(submissionData, {
								onSuccess: resolve,
								onError: reject
							});
						});

						Logger.info('Scheduled group message created successfully', {
							component: 'GroupScheduleModal',
							data: { groupId }
						});

						// Manually invalidate queries to ensure immediate update
						queryClient.invalidateQueries({
							queryKey: ['group-schedules'],
							refetchType: 'active',
						});
					}
				}

				// Close modal after successful operation
				setErrorMessage(""); // Clear any error state
				toast.success(isEditMode ? 'Message updated' : 'Message scheduled');
				setIsOpen(false);
				form.reset();
			} catch (error) {
				const errorMsg = extractErrorMessage(error);
				setErrorMessage(errorMsg);
				toast.error(errorMsg);

				Logger.error('Failed to process group message', {
					component: 'GroupScheduleModal',
					data: {
						groupId,
						error: error instanceof Error ? error.message : String(error),
						extractedError: errorMsg,
						wasImmediate: shouldSendImmediately(value.scheduled_time)
					}
				});
			} finally {
				setIsSubmitting(false);
			}
		},
	});

	// Populate form when existing group schedule data is loaded
	useEffect(() => {
		if (existingGroupSchedule && isEditMode) {
			Logger.debug('Populating form with existing group schedule data', {
				component: 'GroupScheduleModal',
				data: {
					groupScheduleId,
					group_id: existingGroupSchedule.group.id,
					template: existingGroupSchedule.template,
					text: existingGroupSchedule.text,
					scheduled_time: existingGroupSchedule.scheduled_time,
				},
			});

			form.setFieldValue('template_id', existingGroupSchedule.template?.toString() || '');
			form.setFieldValue('text', existingGroupSchedule.text || '');
			form.setFieldValue('scheduled_time', dayjs(existingGroupSchedule.scheduled_time).toISOString());
		}
	}, [existingGroupSchedule, isEditMode, groupScheduleId]);

	// Reset form when modal opens/closes or mode changes
	useEffect(() => {
		if (!isOpen) {
			form.reset();
			setErrorMessage(""); // Clear error when modal closes
		} else if (!isEditMode) {
			// Clear form for create mode and set default scheduled time
			form.reset();
			form.setFieldValue('scheduled_time', dayjs().add(Number(import.meta.env.VITE_MIN_MESSAGE_DELAY || 5), 'minute').toISOString());
		}
	}, [isOpen, isEditMode]);


	const buttonText = isEditMode ? 'Update' : 'Create';
	const heading = isEditMode ? 'Edit message for the group' : 'Create new message for the group ';
	const isLoading = isLoadingGroupSchedule || isLoadingTemplates;
	const [currentScheduledTime, setCurrentScheduledTime] = useState(form.getFieldValue('scheduled_time'));
	const isPastTime = Boolean(currentScheduledTime && isTimeInPast(currentScheduledTime));

	return (
		<Dialog
			open={isOpen}
			onClose={() => {
				return false;
			}}
		>
			<DialogTitle className="text-center">{heading}</DialogTitle>
			<DialogBody>
				{errorMessage && (
					<div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
						<div className="flex items-center">
							<div className="flex-shrink-0">
								<svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
									<path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
								</svg>
							</div>
							<div className="ml-3">
								<h3 className="text-sm font-medium text-red-800 dark:text-red-400">
									Error
								</h3>
								<div className="mt-1 text-sm text-red-700 dark:text-red-400">
									{errorMessage}
								</div>
							</div>
						</div>
					</div>
				)}
				{isLoading ? (
					<div className="flex justify-center items-center py-8">
						<div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
						<span className="ml-2">Loading...</span>
					</div>
				) : (
					<form
						id="group-schedule-form"
						className="space-y-4"
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							form.handleSubmit();
						}}
					>
						<form.Field
							name="scheduled_time"
							children={(field) => (
								<ScheduleDateTimePicker
									value={field.state.value}
									onChange={(isoString) => {
										field.handleChange(isoString);
										setCurrentScheduledTime(isoString);
									}}
								/>
							)}
						/>

						<form.Field
							name="template_id"
							children={(field) => (
								<Field>
									<Label>Template (Optional)</Label>
									<Select
										name={field.name}
										value={field.state.value}
										onChange={(e) => {
											const newTemplateId = e.target.value;
											const previousTemplateId = field.state.value;

											field.handleChange(newTemplateId);

											if (newTemplateId && templates) {
												// Template is selected - populate text field with template content
												const selectedTemplate = templates.find(
													(template: any) => template.id.toString() === newTemplateId
												);
												if (selectedTemplate?.text) {
													form.setFieldValue('text', selectedTemplate.text);
												}
											} else {
												// Switching to custom message
												if (previousTemplateId && templates) {
													// If switching from a template, preserve the template text
													const previousTemplate = templates.find(
														(template: any) => template.id.toString() === previousTemplateId
													);
													if (previousTemplate?.text) {
														form.setFieldValue('text', previousTemplate.text);
													}
												}
												// Clear template_id when "Custom message" is selected
												form.setFieldValue('template_id', '');
											}
										}}
									>
										<option value="">Custom message</option>
										{templates &&
											Array.isArray(templates) &&
											templates.map((template: any) => (
												<option key={template.id} value={template.id.toString()}>
													{template.name}
												</option>
											))}
									</Select>
													</Field>
							)}
						/>

						<form.Field
							name="text"
							children={(field) => {
								const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
									const newValue = e.target.value;
									const currentTemplateId = form.getFieldValue('template_id');

									// Check if text has been changed from original template
									if (currentTemplateId && templates) {
										const originalTemplate = templates.find((t: any) => t.id.toString() === currentTemplateId);
										const originalText = originalTemplate?.text || '';

										// If user has modified the template text, reset to "Custom message"
										if (newValue !== originalText) {
											form.setFieldValue('template_id', '');
										}
									}

									// Handle length limit
									if (newValue.length > Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH)) {
										field.handleChange(
											newValue.substring(0, Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH))
										);
									} else {
										field.handleChange(newValue);
									}
								};

								return (
									<Field>
										<Label>Message *</Label>
										<Textarea
											name={field.name}
											rows={6}
											placeholder="Enter your message text or select a template above..."
											value={field.state.value}
											onChange={handleMessageChange}
										/>
										<div className="text-sm text-zinc-500 dark:text-zinc-400 mt-1 text-right">
											<div>
												Characters: {field.state.value.length} /{' '}
												{import.meta.env.VITE_MAX_TEMPLATE_LENGTH}
											</div>
											<div>
												Message parts:{' '}
												{field.state.value.length === 0
													? '0'
													: field.state.value.length > 160
														? '2'
														: '1'}{' '}
												/ 2
											</div>
										</div>
									</Field>
								);
							}}
							/>
					</form>
				)}
			</DialogBody>
			<DialogActions className="flex justify-end">
				<div className="flex gap-2">
					<Button
						outline
						onClick={() => {
							Logger.debug('Cancel button clicked', {
								component: 'GroupScheduleModal',
							});
							setErrorMessage(""); // Clear error when canceling
							setIsOpen(false);
							form.reset();
						}}
						disabled={isSubmitting}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						form="group-schedule-form"
						color="emerald"
						disabled={isSubmitting || isLoading || isPastTime}
					>
						{isSubmitting ? (
							<span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
						) : (
							buttonText
						)}
					</Button>
				</div>
			</DialogActions>
		</Dialog>
	);
}
