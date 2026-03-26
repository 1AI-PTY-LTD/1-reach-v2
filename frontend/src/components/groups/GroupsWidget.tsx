import { Heading } from '../../ui/heading';
import { Input, InputGroup } from '../../ui/input';
import { Table, TableBody, TableCell, TableRow } from '../../ui/table';
import { Avatar } from '../../ui/avatar';
import { Button } from '../../ui/button';
import { Text } from '../../ui/text';
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/16/solid';
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { getSearchInGroupsQueryOptions } from '../../api/groupsApi';
import { useDebounce } from '../../hooks/useDebounce';
import { useRouterState, useNavigate } from '@tanstack/react-router';
import Logger from '../../utils/logger';
import GroupsModal from './GroupsModal';
import type { ContactGroup } from '../../types';
import { useApiClient } from '../../lib/ApiClientProvider';

export default function GroupsWidget({ userGroups }: { userGroups: ContactGroup[] }) {
	Logger.debug('Rendering GroupsWidget', {
		component: 'GroupsWidget',
		data: { groupCount: userGroups.length },
	});

	const navigate = useNavigate();
	const client = useApiClient();

	//get the selected group id
	const selected = useRouterState({
		select: (state) => state.location,
	});

	const params = selected.pathname.startsWith('/app/groups/')
		? { groupId: selected.pathname.split('/').pop() }
		: null;

	const [lastSearchResults, setLastSearchResults] = useState<ContactGroup[] | null>(null);
	const [searchString, setSearchString] = useState('');
	const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
	const debouncedSearchString = useDebounce(searchString, 300);

	const { data: searchGroups, isFetching } = useQuery({
		...getSearchInGroupsQueryOptions(client, debouncedSearchString),
		enabled: searchString.length >= 2,
	});

	useEffect(() => {
		if (searchGroups) {
			Logger.debug('Search results updated', {
				component: 'GroupsWidget',
				data: {
					searchTerm: debouncedSearchString,
					resultsCount: searchGroups.length,
				},
			});
			setLastSearchResults(searchGroups);
		}
	}, [searchGroups, debouncedSearchString]);

	let groupsToRender = userGroups;
	if (!isFetching && searchGroups) {
		groupsToRender = searchGroups;
	} else if (lastSearchResults && debouncedSearchString.length > 1) {
		groupsToRender = lastSearchResults;
	}

	const renderedGroups = groupsToRender.map((group, i) => {
		const initials = group.name.charAt(0).toUpperCase() + (group.name.charAt(1) || '').toUpperCase();
		const isSelected = params?.groupId === group.id.toString();

		return (
			<TableRow
				key={i}
				to="/app/groups/$groupId"
				params={{ groupId: group.id }}
				className={isSelected ? 'font-bold' : ''}
			>
				<TableCell className={isSelected ? 'w-10 rounded-l-md bg-purple-50 dark:bg-purple-950/30 m4' : 'w-10'}>
					<Avatar
						square
						initials={initials}
						className={
							isSelected
								? 'bg-zinc-800 text-white font-bold'
								: 'size-8 text-black dark:bg-zinc-800 dark:text-zinc-300 '
						}
					></Avatar>
				</TableCell>
				<TableCell className={isSelected ? ' rounded-r-lg bg-purple-50 dark:bg-purple-950/30' : ''}>
					<div className="flex flex-col">
						<span className="font-medium">{group.name}</span>
					</div>
				</TableCell>
			</TableRow>
		);
	});

	function handleSearchStringChange(e: React.ChangeEvent<HTMLInputElement>) {
		Logger.debug('Search string changed', {
			component: 'GroupsWidget',
			data: {
				searchTerm: e.target.value,
				length: e.target.value.length,
			},
		});
		setSearchString(e.target.value);
	}

	const getSearchMessage = () => {
		if (isFetching) return 'Looking for groups...';
		if (searchGroups?.length === 0) return "Didn't find any groups";
		return 'Min. 2 letters to start search';
	};

	let searchMsg = getSearchMessage();
	const debouncedSearchMessage = useDebounce(searchMsg, 100);

	const handleGroupCreated = (createdGroup: ContactGroup) => {
		Logger.info('Navigating to newly created group', {
			component: 'GroupsWidget',
			data: { groupId: createdGroup.id, groupName: createdGroup.name },
		});
		navigate({
			to: '/app/groups/$groupId',
			params: { groupId: createdGroup.id },
		});
	};

	return (
		<div className="h-full flex flex-col border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
			<div className="flex flex-row justify-between align-middle mb-4">
				<Heading>Groups</Heading>
				<Button
					color="emerald"
					type="button"
					onClick={() => {
						Logger.info('Opening create group modal', { component: 'GroupsWidget' });
						setIsModalOpen(true);
					}}
				>
					<PlusIcon />
					Add
				</Button>
			</div>
			<div className="min-h-20">
				<InputGroup>
					<MagnifyingGlassIcon />
					<Input
						name="search"
						aria-label="Search"
						className="mb-4"
						autoComplete="off"
						value={searchString}
						onChange={handleSearchStringChange}
					/>
					<Text className="text-center">{debouncedSearchMessage}</Text>
				</InputGroup>
			</div>
			<div className="flex-1 min-h-0 overflow-auto">
				{groupsToRender.length === 0 && !isFetching ? (
					<div className="flex flex-col items-center justify-center py-12 text-center">
						<Text className="text-zinc-400">No groups yet</Text>
						<Text className="text-sm text-zinc-400">Click "Add" to create your first group</Text>
					</div>
				) : (
					<Table>
						<TableBody>{renderedGroups}</TableBody>
					</Table>
				)}
			</div>
			<GroupsModal isOpen={isModalOpen} setIsOpen={setIsModalOpen} onGroupCreated={handleGroupCreated} />
		</div>
	);
}
