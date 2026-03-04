import { Dialog, DialogActions, DialogBody, DialogTitle } from '../../ui/dialog';
import { Field, Label } from '../../ui/fieldset';
import { Input } from '../../ui/input';
import { Button } from '../../ui/button';
import { useForm } from '@tanstack/react-form';
import Logger from '../../utils/logger';
import { Textarea } from '../../ui/textarea';
import { useEffect, useState } from 'react';
import { useCreateGroupMutation, useUpdateGroupMutation, getGroupByIdQueryOptions } from '../../api/groupsApi';
import { useQuery } from '@tanstack/react-query';
import type { ContactGroup } from '../../types';
import { useApiClient } from '../../lib/ApiClientProvider';

export default function GroupsModal({
	groupId,
	isOpen,
	setIsOpen,
	onGroupCreated,
}: {
	groupId?: number;
	isOpen: boolean;
	setIsOpen: (value: boolean) => void;
	onGroupCreated?: (group: ContactGroup) => void;
}) {
	const client = useApiClient();
	const createNewGroup = useCreateGroupMutation(client);
	const updateGroup = useUpdateGroupMutation(client);
	const isEditMode = !!groupId;

	// Load existing group data if editing
	const { data: existingGroup, isLoading } = useQuery({
		...getGroupByIdQueryOptions(client, groupId!),
		enabled: isEditMode && isOpen,
	});

	const form = useForm({
		defaultValues: {
			groupName: '',
			groupDescription: '',
		},
		onSubmit: ({ value }) => {
			Logger.debug('Submit form data', {
				component: 'Groups Modal',
				data: {
					name: value.groupName,
					description: value.groupDescription,
					isEditMode,
					groupId,
				},
			});

			if (isEditMode && groupId) {
				// Update existing group
				updateGroup.mutate(
					{
						id: groupId,
						name: value.groupName,
						description: value.groupDescription || '',
					},
					{
						onSuccess: () => {
							Logger.info('Group updated successfully', {
								component: 'GroupsModal',
								data: { groupId },
							});
							setIsOpen(false);
							form.reset();
						},
						onError: (error) => {
							Logger.error('Failed to update group', {
								component: 'GroupsModal',
								data: { groupId, error: error.message },
							});
						},
					}
				);
			} else {
				// Create new group
				createNewGroup.mutate(
					{
						name: value.groupName,
						description: value.groupDescription || '',
					},
					{
						onSuccess: (createdGroup) => {
							Logger.info('Group created successfully', {
								component: 'GroupsModal',
								data: { groupId: createdGroup.id, groupName: createdGroup.name },
							});
							setIsOpen(false);
							form.reset();
							// Navigate to the newly created group
							if (onGroupCreated) {
								onGroupCreated(createdGroup);
							}
						},
						onError: (error) => {
							Logger.error('Failed to create group', {
								component: 'GroupsModal',
								data: { error: error.message },
							});
						},
					}
				);
			}
		},
	});

	// Populate form when existing group data is loaded
	useEffect(() => {
		if (existingGroup && isEditMode) {
			Logger.debug('Populating form with existing group data', {
				component: 'GroupsModal',
				data: {
					groupId,
					name: existingGroup.name,
					description: existingGroup.description,
				},
			});

			form.setFieldValue('groupName', existingGroup.name);
			form.setFieldValue('groupDescription', existingGroup.description || '');
		}
	}, [existingGroup, isEditMode, groupId]);

	// Reset form when modal opens/closes or mode changes
	useEffect(() => {
		if (!isOpen) {
			form.reset();
		} else if (!isEditMode) {
			// Clear form for create mode
			form.reset();
		}
	}, [isOpen, isEditMode]);

	const buttonText = isEditMode ? 'Update Group' : 'Create Group';
	const heading = isEditMode ? 'Edit Group' : 'Create New Group';
	const isSubmitting = createNewGroup.isPending || updateGroup.isPending;

	return (
		<Dialog
			open={isOpen}
			onClose={() => {
				return false;
			}}
		>
			<DialogTitle className="text-center">{heading}</DialogTitle>
			<DialogBody>
				{isEditMode && isLoading ? (
					<div className="flex justify-center items-center py-8">
						<div className="h-6 w-6 animate-spin rounded-full border-2 border-zinc-300 border-t-blue-600" />
						<span className="ml-2">Loading group data...</span>
					</div>
				) : (
					<form
						id="group-form"
						onSubmit={(e) => {
							e.preventDefault();
							e.stopPropagation();
							form.handleSubmit();
						}}
					>
						<form.Field
							name="groupName"
							children={(field) => (
								<Field className="mb-4">
									<Label>Group Name</Label>
									<Input
										name={field.name}
										placeholder="Group name"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</Field>
							)}
						/>
						<form.Field
							name="groupDescription"
							children={(field) => (
								<Field className="mb-4">
									<Label>Group Description</Label>
									<Textarea
										name={field.name}
										placeholder="Group description"
										value={field.state.value}
										onChange={(e) => field.handleChange(e.target.value)}
									/>
								</Field>
							)}
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
								component: 'GroupsModal',
							});
							setIsOpen(false);
							form.reset();
						}}
						disabled={isSubmitting}
					>
						Cancel
					</Button>
					<Button
						type="submit"
						form="group-form"
						color="emerald"
						disabled={isSubmitting || (isEditMode && isLoading)}
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
