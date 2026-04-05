import { PencilIcon, TrashIcon } from "@heroicons/react/16/solid";
import { Button } from "../ui/button";
import { Divider } from "../ui/divider";
import { Heading } from "../ui/heading";
import { Text } from "../ui/text";
import type { Template } from "../types/template.types";
import { useUpdateTemplateMutation } from "../api/templatesApi";
import { SMS_SEGMENT_LIMIT } from "../lib/sms";
import { useApiClient } from "../lib/ApiClientProvider";
import Logger from "../utils/logger";
import { Alert, AlertTitle, AlertDescription, AlertActions } from "../ui/alert";
import { useState } from "react";
import { toast } from "sonner";

export default function TemplateDetails({
    template,
    setIsOpen,
    setTemplateId,
}: {
    template: Template;
    setIsOpen: (arg: boolean) => void;
    setTemplateId: (arg: number) => void;
}) {
    // Logger.debug("Rendering TemplateDetails", {
    //     component: "TemplateDetails",
    //     data: {
    //         templateId: template.id,
    //         templateName: template.name,
    //         textLength: template.text.length
    //     }
    // });

    const [isAlertOpen, setIsAlertOpen] = useState(false);
    const client = useApiClient();
    const updateTemplate = useUpdateTemplateMutation(client);

    const handleEdit = () => {
        Logger.info("Opening edit template modal", {
            component: "TemplateDetails",
            data: {
                templateId: template.id,
                templateName: template.name
            }
        });
        setTemplateId(template.id);
        setIsOpen(true);
    };

    const handleDelete = async () => {
        try {
            await updateTemplate.mutateAsync({ id: template.id, is_active: false });
            toast.success("Template deleted");
        } catch {
            toast.error("Failed to delete template");
        }
    };

    return (
        <div className="border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
            <div className="flex justify-between mb-2">
                <Heading>Template Name: {template.name}</Heading>
                <Heading>Message parts: {template.text.length === 0 ? "0" : template.text.length > SMS_SEGMENT_LIMIT ? "2" : "1"} of 2</Heading>

            </div>
            <Text>{template.text}</Text>
            <br />
            <Divider />
            <div className="flex justify-between mt-4">
                <Button
                    color="red"
                    onClick={() => setIsAlertOpen(true)}
                >
                    <TrashIcon />
                    Delete
                </Button>
                <Button
                    color="light"
                    onClick={handleEdit}
                >
                    <PencilIcon />
                    Edit
                </Button>
            </div>
            <Alert
                open={isAlertOpen}
                onClose={() => setIsAlertOpen(false)}
            >
                <AlertTitle>Are you sure you want to delete this template?</AlertTitle>
                <AlertDescription>
                    The template will be permanently removed from the list.
                </AlertDescription>
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
                        disabled={updateTemplate.isPending}
                    >
                        {updateTemplate.isPending ? (
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
