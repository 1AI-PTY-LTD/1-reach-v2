import { Heading } from "../ui/heading";
import { Input, InputGroup } from "../ui/input";
import { Table, TableBody, TableCell, TableRow } from "../ui/table";
import { Avatar } from "../ui/avatar";
import { Button } from "../ui/button";
import { MagnifyingGlassIcon, PlusIcon } from "@heroicons/react/16/solid";
import { TemplateModal } from "./TemplateModal";
import { useState, Suspense } from "react";
import TemplateDetails from "./TemplateDetails";
import type { Template } from "../types/template.types";
import Logger from "../utils/logger";
import { useSuspenseQuery } from "@tanstack/react-query";
import { getAllTemplatesQueryOptions } from "../api/templatesApi";
import { useApiClient } from "../lib/ApiClientProvider";
import LoadingSpinner from "./shared/LoadingSpinner";

function TemplatesContent() {
    const client = useApiClient();
    const { data: templates } = useSuspenseQuery(getAllTemplatesQueryOptions(client));

    // Logger.debug("Rendering TemplatesWidget", {
    //     component: "TemplatesWidget",
    //     data: { templateCount: templates.length }
    // });

    const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
    const [selectedTemplateId, setSelectedTemplateId] = useState<
        number | undefined
    >(templates.length > 0 ? templates[0].id : undefined);
    const [editTemplateId, setEditTemplateId] = useState<number | undefined>(
        templates.length > 0 ? templates[0].id : undefined
    );

    if (selectedTemplateId && !getTemplateById(selectedTemplateId)) {
        setSelectedTemplateId(templates[0].id);
    }

    const renderedTemplates = templates.map((entry) => {
        const initials = entry.name.charAt(0).toUpperCase() + (entry.name.charAt(1) || "").toUpperCase();
        const isSelected = selectedTemplateId === entry.id;

        return (
            <TableRow
                className={`hover:bg-zinc-50 dark:hover:bg-zinc-700`}
                key={entry.id}
                onClick={() => {
                    Logger.debug("Template row selected", {
                        component: "TemplatesWidget",
                        data: {
                            templateId: entry.id,
                            previousSelection: selectedTemplateId,
                        },
                    });
                    setSelectedTemplateId(entry.id);
                }}
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
                                ? "w-8 bg-zinc-800 text-white font-bold"
                                : "w-8 text-black dark:bg-zinc-800 dark:text-zinc-300 "
                        }
                    />
                </TableCell>
                <TableCell
                    className={isSelected ? " rounded-r-lg bg-purple-50" : ""}
                >
                    <div className="flex flex-col">
                        <span className="font-medium">{entry.name}</span>
                    </div>
                </TableCell>
            </TableRow>
        );
    });

    function getTemplateById(
        templateId: number | undefined
    ): Template | undefined {
        if (!templateId) return undefined;
        const template = templates.find((entry) => {
            return entry.id === templateId;
        });
        Logger.debug("Template lookup result", {
            component: "TemplatesWidget",
            data: {
                searchId: templateId,
                found: !!template,
            },
        });
        return template;
    }

    const handleAddTemplate = () => {
        Logger.info("Opening create template modal", {
            component: "TemplatesWidget",
        });
        setEditTemplateId(undefined);
        setIsModalOpen(true);
    };

    return (
        <div className="flex">
            <div className="w-1/4 overflow-hidden border-light-gray mr-4 bg-white dark:bg-zinc-900 rounded-lg shadow-lg">
                <div className="max-h-[85vh] flex flex-col border rounded-lg p-4 border-zinc-950/10 dark:border-white/10">
                    <div className="flex flex-row justify-between align-middle mb-4">
                        <Heading>Templates</Heading>
                        <Button
                            color="emerald"
                            onClick={handleAddTemplate}
                        >
                            <PlusIcon />
                            Add
                        </Button>
                    </div>
                    <InputGroup>
                        <MagnifyingGlassIcon />
                        <Input
                            name="search"
                            aria-label="Search"
                            className="mb-4"
                        />
                    </InputGroup>
                    <div className="flex-1 min-h-0 overflow-auto">
                        {templates.length === 0 ? (
                            <div className="flex flex-col items-center justify-center py-12 text-center">
                                <p className="text-zinc-400">No templates yet</p>
                                <p className="text-sm text-zinc-400">Click "Add" to create your first template</p>
                            </div>
                        ) : (
                            <Table>
                                <TableBody>{renderedTemplates}</TableBody>
                            </Table>
                        )}
                    </div>
                    <TemplateModal
                        isOpen={isModalOpen}
                        setIsOpen={setIsModalOpen}
                        setSelectedTemplateId={setSelectedTemplateId}
                        template={getTemplateById(editTemplateId)}
                    ></TemplateModal>
                </div>
            </div>
            <div className="w-3/4 overflow-auto border-light-gray rounded-lg">
                {selectedTemplateId !== undefined &&
                getTemplateById(selectedTemplateId) ? (
                    <TemplateDetails
                        template={getTemplateById(selectedTemplateId)!}
                        setIsOpen={setIsModalOpen}
                        setTemplateId={setEditTemplateId}
                    />
                ) : null}
            </div>
        </div>
    );
}

export default function TemplatesWidget() {
    return (
        <Suspense fallback={<LoadingSpinner />}>
            <TemplatesContent />
        </Suspense>
    );
}
