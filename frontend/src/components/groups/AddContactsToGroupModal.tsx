import * as React from 'react'
import { Dialog, DialogActions, DialogBody, DialogTitle } from '../../ui/dialog'
import { Input, InputGroup } from '../../ui/input'
import { Button } from '../../ui/button'
import { Table, TableBody, TableCell, TableRow } from '../../ui/table'
import { Avatar } from '../../ui/avatar'
import { Text } from '../../ui/text'
import { MagnifyingGlassIcon, PlusIcon } from '@heroicons/react/16/solid'
import { useQuery } from '@tanstack/react-query'
import { getAllContactsExcludingGroupQueryOptions, searchContactsExcludingGroupQueryOptions } from '../../api/contactsApi'
import { useAddMembersToGroupMutation } from '../../api/groupsApi'
import { useDebounce } from '../../hooks/useDebounce'
import type { Contact } from '../../types/contact.types'
import Logger from '../../utils/logger'
import clsx from 'clsx'
import { useApiClient } from '../../lib/ApiClientProvider'

export interface AddContactsToGroupModalProps {
    groupId: number
    isOpen: boolean
    setIsOpen: (value: boolean) => void
}

export const AddContactsToGroupModal: React.FC<AddContactsToGroupModalProps> = ({
    groupId,
    isOpen,
    setIsOpen
}) => {
    const client = useApiClient()
    const [searchString, setSearchString] = React.useState('')
    const [lastSearchResults, setLastSearchResults] = React.useState<Contact[] | null>(null)
    const [selectedContactIds, setSelectedContactIds] = React.useState<Set<number>>(new Set())

    const debouncedSearchString = useDebounce(searchString, 300)
    const addMembersMutation = useAddMembersToGroupMutation(client)

    // Get all contacts excluding group members as fallback
    const { data: allContacts } = useQuery(getAllContactsExcludingGroupQueryOptions(client, groupId))

    // Search contacts when search string is provided, excluding group members
    const { data: searchResults, isFetching } = useQuery({
        ...searchContactsExcludingGroupQueryOptions(client, debouncedSearchString, groupId),
        enabled: searchString.length >= 2,
    })

    React.useEffect(() => {
        if (searchResults) {
            Logger.debug('Search results updated', {
                component: 'AddContactsToGroupModal',
                data: {
                    searchTerm: debouncedSearchString,
                    resultsCount: searchResults.length
                }
            })
            setLastSearchResults(searchResults)
        }
    }, [searchResults, debouncedSearchString])

    // Determine which contacts to display (server already excludes group members)
    let availableContacts = allContacts || []
    if (!isFetching && searchResults) {
        availableContacts = searchResults
    } else if (lastSearchResults && debouncedSearchString.length > 1) {
        availableContacts = lastSearchResults
    }

    const handleSearchStringChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        Logger.debug('Search string changed', {
            component: 'AddContactsToGroupModal',
            data: {
                searchTerm: e.target.value,
                length: e.target.value.length
            }
        })
        setSearchString(e.target.value)
    }, [])

    const handleToggleContact = React.useCallback((contactId: number) => {
        setSelectedContactIds(prev => {
            const newSet = new Set(prev)
            if (newSet.has(contactId)) {
                newSet.delete(contactId)
                Logger.debug('Contact deselected', {
                    component: 'AddContactsToGroupModal',
                    data: { contactId }
                })
            } else {
                newSet.add(contactId)
                Logger.debug('Contact selected', {
                    component: 'AddContactsToGroupModal',
                    data: { contactId }
                })
            }
            return newSet
        })
    }, [])

    const handleAddContacts = React.useCallback(async () => {
        if (selectedContactIds.size === 0) return

        try {
            Logger.info('Adding contacts to group', {
                component: 'AddContactsToGroupModal',
                data: {
                    groupId,
                    contact_ids: Array.from(selectedContactIds),
                    count: selectedContactIds.size
                }
            })

            await addMembersMutation.mutateAsync({
                group_id: groupId,
                contact_ids: Array.from(selectedContactIds)
            })

            Logger.info('Contacts added to group successfully', {
                component: 'AddContactsToGroupModal',
                data: { groupId, addedCount: selectedContactIds.size }
            })

            // Reset state and close modal
            setSelectedContactIds(new Set())
            setSearchString('')
            setLastSearchResults(null)
            setIsOpen(false)
        } catch (error) {
            Logger.error('Failed to add contacts to group', {
                component: 'AddContactsToGroupModal',
                data: {
                    groupId,
                    error: error instanceof Error ? error.message : String(error)
                }
            })
        }
    }, [groupId, selectedContactIds, addMembersMutation, setIsOpen])

    const handleCancel = React.useCallback(() => {
        Logger.debug('Cancel button clicked', {
            component: 'AddContactsToGroupModal'
        })
        setSelectedContactIds(new Set())
        setSearchString('')
        setLastSearchResults(null)
        setIsOpen(false)
    }, [setIsOpen])

    const getSearchMessage = () => {
        if (isFetching) return 'Looking for contacts...'
        if (searchResults?.length === 0) return "Didn't find any contacts"
        if (availableContacts.length === 0 && searchString.length < 2) return 'All contacts are already in this group'
        return 'Min. 2 letters to start search'
    }

    const searchMessage = getSearchMessage()
    const debouncedSearchMessage = useDebounce(searchMessage, 100)

    const renderedContacts = availableContacts.map((contact) => {
        const initials = contact.first_name.charAt(0) + contact.last_name.charAt(0)
        const isSelected = selectedContactIds.has(contact.id)

        return (
            <TableRow
                key={contact.id}
                className={clsx(
                    'cursor-pointer transition-colors',
                    isSelected && 'bg-blue-50 dark:bg-blue-900/20'
                )}
                onClick={(e: React.MouseEvent) => {
                    e.stopPropagation()
                    handleToggleContact(contact.id)
                }}
            >
                <TableCell className="w-10">
                    <Avatar
                        square
                        initials={initials}
                        className="size-8 text-black dark:bg-zinc-800 dark:text-zinc-300"
                    />
                </TableCell>
                <TableCell>
                    {contact.first_name} {contact.last_name}
                </TableCell>
                <TableCell className="w-16">
                    <Button
                        color={isSelected ? 'red' : 'emerald'}
                        onClick={(e: React.MouseEvent) => {
                            e.stopPropagation()
                            handleToggleContact(contact.id)
                        }}
                        className="size-8 p-0"
                    >
                        {isSelected ? '−' : <PlusIcon className="size-4" />}
                    </Button>
                </TableCell>
            </TableRow>
        )
    })

    return (
        <Dialog
            open={isOpen}
            onClose={() => false}
        >
            <DialogTitle>Select Contacts To Add</DialogTitle>
            <DialogBody>
                <div className="space-y-4">
                    {/* Search Input */}
                    <div className="min-h-20">
                        <InputGroup>
                            <MagnifyingGlassIcon />
                            <Input
                                name="search"
                                aria-label="Search contacts"
                                placeholder="Search contacts..."
                                autoComplete="off"
                                value={searchString}
                                onChange={handleSearchStringChange}
                            />
                        </InputGroup>
                        <Text className="text-center mt-2 text-sm text-zinc-600 dark:text-zinc-400">
                            {debouncedSearchMessage}
                        </Text>
                    </div>

                    {/* Selected contacts count */}
                        <Text className="text-sm font-medium text-blue-600 dark:text-blue-400">
                            {selectedContactIds.size} contact{selectedContactIds.size !== 1 ? 's' : ''} selected
                        </Text>

                    {/* Contacts Table */}
                    <div className="max-h-96 overflow-auto border rounded-lg border-zinc-200 dark:border-zinc-700">
                        <Table>
                            <TableBody>
                                {renderedContacts.length > 0 ? (
                                    renderedContacts
                                ) : (
                                    <TableRow>
                                        <TableCell colSpan={3} className="text-center py-8">
                                            <Text className="text-zinc-500 dark:text-zinc-400">
                                                {searchString.length >= 2
                                                    ? 'No contacts found'
                                                    : 'Start typing to search for contacts'
                                                }
                                            </Text>
                                        </TableCell>
                                    </TableRow>
                                )}
                            </TableBody>
                        </Table>
                    </div>
                </div>
            </DialogBody>
            <DialogActions>
                <Button
                    outline
                    onClick={handleCancel}
                    disabled={addMembersMutation.isPending}
                >
                    Cancel
                </Button>
                <Button
                    color="emerald"
                    onClick={handleAddContacts}
                    disabled={selectedContactIds.size === 0 || addMembersMutation.isPending}
                >
                    {addMembersMutation.isPending ? (
                        <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                    ) : (
                        `Add ${selectedContactIds.size} Contact${selectedContactIds.size !== 1 ? 's' : ''}`
                    )}
                </Button>
            </DialogActions>
        </Dialog>
    )
}

export default AddContactsToGroupModal
