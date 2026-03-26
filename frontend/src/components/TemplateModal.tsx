import { useForm } from "@tanstack/react-form";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "../ui/dialog";
import { Field, Label } from "../ui/fieldset";
import { Input } from "../ui/input";
import type { Template, CreateTemplate, UpdateTemplate } from "../types/template.types";
import {
    useCreateTemplateMutation,
    useUpdateTemplateMutation,
} from "../api/templatesApi";
import { useApiClient } from "../lib/ApiClientProvider";
import { Button } from "../ui/button";
import { Textarea } from "../ui/textarea";
import Logger from "../utils/logger";
import { toast } from "sonner";

export function TemplateModal({
    isOpen,
    setIsOpen,
    setSelectedTemplateId,
    template,
}: {
    isOpen: boolean;
    setIsOpen: (value: boolean) => void;
    setSelectedTemplateId: (value: number) => void;
    template?: Template | undefined;
}) {
    // Logger.debug("Rendering TemplateModal", {
    //     component: "TemplateModal",
    //     data: {
    //         templateId: template?.id,
    //         mode: template ? "edit" : "create",
    //         isOpen
    //     }
    // });

    const client = useApiClient();
    const createNewTemplate = useCreateTemplateMutation(client);
    const updateTemplate = useUpdateTemplateMutation(client);
    const dialogTitle = template ? "Edit template" : "Create new template";

    const form = useForm({
        defaultValues: {
            name: template ? template.name : "",
            text: template ? template.text : "",
        },
        onSubmit: async ({ value }) => {
            Logger.debug("Form submitted", {
                component: "TemplateModal",
                data: {
                    name: value.name,
                    textLength: value.text.length,
                    mode: template ? "edit" : "create"
                }
            });

            try {
                if (!template) {
                    Logger.info("Creating new template", {
                        component: "TemplateModal",
                        data: { templateName: value.name }
                    });
                    const newTemplateProps: CreateTemplate = {
                        name: value.name,
                        text: value.text,
                    };
                    const newTemplate = await createNewTemplate.mutateAsync({ ...newTemplateProps });
                    Logger.info("Template created successfully", {
                        component: "TemplateModal",
                        data: { templateName: value.name, templateId: newTemplate.id }
                    });
                    setSelectedTemplateId(newTemplate.id);
                } else {
                    Logger.info("Updating template", {
                        component: "TemplateModal",
                        data: {
                            templateId: template.id,
                            templateName: value.name
                        }
                    });
                    const updateTemplateProps: UpdateTemplate = {
                        id: template.id,
                        name: value.name.trim(),
                        text: value.text.trim(),
                    };
                    await updateTemplate.mutateAsync({ ...updateTemplateProps });
                    Logger.info("Template updated successfully", {
                        component: "TemplateModal",
                        data: {
                            templateId: template.id,
                            templateName: value.name
                        }
                    });
                }
                toast.success(template ? "Template updated" : "Template created");
                setIsOpen(false);
                form.reset();
            } catch (error) {
                toast.error("Failed to save template");
                Logger.error("Failed to save template", {
                    component: "TemplateModal",
                    data: {
                        templateId: template?.id,
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
            }
        },
    });

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>, field: any) => {
        Logger.debug("Template name changed", {
            component: "TemplateModal",
            data: {
                newName: e.target.value,
                length: e.target.value.length
            }
        });
        field.handleChange(e.target.value);
    };

    const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>, field: any) => {
        const newValue = e.target.value;
        Logger.debug("Template text changed", {
            component: "TemplateModal",
            data: {
                textLength: newValue.length,
                truncated: newValue.length > import.meta.env.VITE_MAX_TEMPLATE_LENGTH
            }
        });

        if (newValue.length > import.meta.env.VITE_MAX_TEMPLATE_LENGTH) {
            //allow up to max template length characters
            field.handleChange(newValue.substring(0, import.meta.env.VITE_MAX_TEMPLATE_LENGTH));
        } else {
            field.handleChange(newValue);
        }
    };

    const handleCancel = () => {
        Logger.debug("Cancel button clicked", {
            component: "TemplateModal"
        });
        setIsOpen(false);
        form.reset();
    };

    return (
        <Dialog
            open={isOpen}
            onClose={() => setIsOpen(false)}
        >
            <DialogTitle>{dialogTitle}</DialogTitle>
            <DialogBody>
                <form
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        form.handleSubmit();
                    }}
                >
                    <form.Field
                        name="name"
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>Template Name</Label>
                                <Input
                                    name={field.name}
                                    placeholder="Template name"
                                    value={field.state.value}
                                    maxLength={255}
                                    onChange={(e) => handleNameChange(e, field)}
                                    autoFocus
                                />
                            </Field>
                        )}
                    />
                    <form.Field
                        name="text"
                        validators={{
                            onChange: ({ value }) => {
                                if (value.length < 3) {
                                    Logger.warn("Template text validation failed", {
                                        component: "TemplateModal",
                                        data: {
                                            length: value.length,
                                            reason: "too short"
                                        }
                                    });
                                    return "Text must be at least 3 characters";
                                } else if (value.length > import.meta.env.VITE_MAX_TEMPLATE_LENGTH) {
                                    Logger.warn("Template text validation failed", {
                                        component: "TemplateModal",
                                        data: {
                                            length: value.length,
                                            reason: "too long"
                                        }
                                    });
                                    return `Text must be less than ${import.meta.env.VITE_MAX_TEMPLATE_LENGTH} characters`;
                                }
                                return undefined;
                            },
                        }}
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>Text</Label>
                                <Textarea
                                    name={field.name}
                                    placeholder="Template text"
                                    value={field.state.value}
                                    onChange={(e) => handleTextChange(e, field)}
                                    rows={6}
                                    autoFocus
                                    autoComplete="off"
                                />
                                <div className="text-sm mt-1 flex justify-between">
                                    {field.state.meta.errors && (
                                        <div className="text-red-500 dark:text-red-400">
                                            {field.state.meta.errors}
                                        </div>
                                    )}
                                    <div>
                                        Characters: {field.state.value.length} / {import.meta.env.VITE_MAX_TEMPLATE_LENGTH}
                                    </div>
                                </div>
                                <div className="text-sm mt-1 flex justify-end">
                                    Message parts: {field.state.value.length === 0 ? "0" : field.state.value.length > 160 ? "2" : "1"} / 2
                                </div>
                            </Field>
                        )}
                    />
                    <DialogActions>
                        <Button
                            type="button"
                            color="light"
                            onClick={handleCancel}
                        >
                            Cancel
                        </Button>
                        <Button
                            color="emerald"
                            type="submit"
                            disabled={createNewTemplate.isPending || updateTemplate.isPending}
                        >
                            {(createNewTemplate.isPending || updateTemplate.isPending) ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (template ? "Update" : "Create")}
                        </Button>
                    </DialogActions>
                </form>
            </DialogBody>
        </Dialog>
    );
}
