import { Heading } from "../../ui/heading";
import { Input, InputGroup } from "../../ui/input";
import { Table, TableBody, TableCell, TableRow } from "../../ui/table";
import { Avatar } from "../../ui/avatar";
import { Button } from "../../ui/button";
import { Text } from "../../ui/text";
import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/16/solid";
import { useEffect, useState } from "react";
import { ContactModal } from "./CustomerModal";
import { useQuery } from "@tanstack/react-query";
import { getSearchContactsQueryOptions } from "../../api/contactsApi";
import { useDebounce } from "../../hooks/useDebounce";
import { useRouterState } from "@tanstack/react-router";
import Logger from "../../utils/logger";
import UploadFileModal from "./UploadFileModal";
import type { Contact } from "../../types/contact.types";
import { useApiClient } from "../../lib/ApiClientProvider";

export default function ContactsWidget({
    contacts,
}: {
    contacts: Contact[];
}) {
    const client = useApiClient();

    Logger.debug("Rendering ContactsWidget", {
        component: "ContactsWidget",
        data: { contactCount: contacts.length },
    });

    //get the selected contact id
    const selected = useRouterState({
        select: (state) => state.location,
    });

    const params = selected.pathname.startsWith("/app/contacts/")
        ? { contactId: selected.pathname.split("/").pop() }
        : null;

    const [lastSearchResults, setLastSearchResults] =
        useState<Contact[] | null>(null);
    const [searchString, setSearchString] = useState("");
    const [isCreateUserModalOpen, setIsCreateUserModalOpen] = useState(false);
    const [isFileUploadOpen, setIsFileUploadOpen] = useState(false);
    const debouncedSearchString = useDebounce(searchString, 300);

    const { data: searchUsers, isFetching } = useQuery({
        ...getSearchContactsQueryOptions(client, debouncedSearchString),
        enabled: searchString.length >= 2,
    });

    useEffect(() => {
        if (searchUsers) {
            Logger.debug("Search results updated", {
                component: "ContactsWidget",
                data: {
                    searchTerm: debouncedSearchString,
                    resultsCount: searchUsers.length,
                },
            });
            setLastSearchResults(searchUsers);
        }
    }, [searchUsers, debouncedSearchString]);

    let contactsToRender = contacts;
    if (!isFetching && searchUsers) {
        contactsToRender = searchUsers;
    } else if (lastSearchResults && debouncedSearchString.length > 1) {
        contactsToRender = lastSearchResults;
    }

    const renderedContacts = contactsToRender.map((entry: Contact, i: number) => {
        const initials = entry.first_name.charAt(0) + entry.last_name.charAt(0);
        const isSelected = params?.contactId === entry.id.toString();

        return (
            <TableRow
                key={i}
                to="/app/contacts/$contactId"
                params={{ contactId: entry.id }}
                className={isSelected ? "font-bold" : ""}
            >
                <TableCell
                    className={
                        isSelected
                            ? "w-10 rounded-l-md bg-purple-50 m4"
                            : "w-10"
                    }
                >
                    <Avatar
                        square
                        initials={initials}
                        className={
                            isSelected
                                ? "bg-zinc-800 text-white font-bold"
                                : "size-8 text-black dark:bg-zinc-800 dark:text-zinc-300 "
                        }
                    ></Avatar>
                </TableCell>
                <TableCell
                    className={isSelected ? " rounded-r-lg bg-purple-50" : ""}
                >
                    <div>
                        <div>{entry.first_name} {entry.last_name}</div>
                        <div className="text-xs text-zinc-500">
                            {entry.phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')}
                        </div>
                    </div>
                </TableCell>
            </TableRow>
        );
    });

    function handleSearchStringChange(e: React.ChangeEvent<HTMLInputElement>) {
        Logger.debug("Search string changed", {
            component: "ContactsWidget",
            data: {
                searchTerm: e.target.value,
                length: e.target.value.length,
            },
        });
        setSearchString(e.target.value);
    }

    const getSearchMessage = () => {
        if (isFetching) return "Looking for contacts...";
        if (searchUsers?.length === 0) return "Didn't find any contacts";
        return "Min. 2 letters to start search";
    };

    let searchMsg = getSearchMessage();
    const debouncedSearchMessage = useDebounce(searchMsg, 100);

    return (
        <div className="max-h-[85vh] flex flex-col rounded-lg p-4 border-zinc-950/10 dark:border-white/10">
            <div className="flex flex-row justify-between align-middle mb-4">
                <Heading>Contacts</Heading>
                <Button
                    color="emerald"
                    type="button"
                    onClick={() => {
                        Logger.info("Opening create contact modal", {
                            component: "ContactsWidget",
                        });
                        setIsCreateUserModalOpen(true);
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
                    <Text className="text-center">
                        {debouncedSearchMessage}
                    </Text>
                </InputGroup>
            </div>
            <div className="flex-1 min-h-0 overflow-auto">
                {contactsToRender.length === 0 && !isFetching ? (
                    <div className="flex flex-col items-center justify-center py-12 text-center">
                        <Text className="text-zinc-400">No contacts yet</Text>
                        <Text className="text-sm text-zinc-400">Click "Add" to create your first contact</Text>
                    </div>
                ) : (
                    <Table dense>
                        <TableBody>{renderedContacts}</TableBody>
                    </Table>
                )}
            </div>
            <div className="pt-3 flex justify-center">
                <Button
                    outline
                    onClick={() => setIsFileUploadOpen(true)}
                >
                    <PlusIcon />
                        Add Contacts from file
                </Button>
            </div>
            <ContactModal
                isOpen={isCreateUserModalOpen}
                setIsOpen={setIsCreateUserModalOpen}
            />
            <UploadFileModal
                isOpen={isFileUploadOpen}
                setIsOpen={setIsFileUploadOpen}
            />
        </div>
    );
}
