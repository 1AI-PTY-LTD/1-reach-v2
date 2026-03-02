import { Heading } from "../ui/heading";
import { Input, InputGroup } from "../ui/input";
import { Table, TableBody, TableCell, TableRow } from "../ui/table";
import dayjs from "dayjs";
import { MagnifyingGlassIcon } from "@heroicons/react/16/solid";
import type { Schedule } from "../types/schedule.types";
import Logger from "../utils/logger";

// TODO check if this component is neccesary

export default function MessagesWidget({
    messages,
}: {
    messages: Schedule[];
}) {
    Logger.debug("Rendering MessagesWidget", {
        component: "MessagesWidget",
        data: { messageCount: messages.length }
    });

    const renderedMessages = messages.map((entry) => {
        return (
            <TableRow
                key={entry.id}
                to="/app/schedule/$msgId"
                params={{ msgId: entry.id }}
            >
                <TableCell>
                    {dayjs(entry.scheduled_time).format("h:mma").toLowerCase()}{" "}
                </TableCell>
                <TableCell> {entry.text}</TableCell>
            </TableRow>
        );
    });

    return (
        <div className="flex flex-col border rounded-lg p-4 border-zinc-950/10 dark:border-white/10">
            <Heading className="mb-4">Messages</Heading>
            <InputGroup>
                <MagnifyingGlassIcon />
                <Input
                    name="search"
                    aria-label="Search"
                    className="mb-4"
                />
            </InputGroup>
            <div className="flex-1 min-h-0 overflow-auto">
                <Table>
                    <TableBody>{renderedMessages}</TableBody>
                </Table>
            </div>
        </div>
    );
}
