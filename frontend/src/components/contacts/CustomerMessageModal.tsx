import { useForm } from "@tanstack/react-form";
import type { Contact } from "../../types/contact.types";
import { Dialog, DialogActions, DialogBody, DialogTitle } from "../../ui/dialog";
import { Field, Label } from "../../ui/fieldset";
import { Button } from "../../ui/button";
import {
    useCreateScheduleMutation,
    useUpdateScheduleMutation,
} from "../../api/schedulesApi";
import type { Schedule, CreateSchedule, UpdateSchedule } from "../../types/schedule.types";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getAllTemplatesQueryOptions } from "../../api/templatesApi";
import { Select } from "../../ui/select";
import dayjs from "dayjs";
import { Textarea } from "../../ui/textarea";
import Logger from "../../utils/logger";
import { sendSms } from "../../api/smsApi";
import type { SendSmsRequest } from "../../types/sms.types";
import { useState } from "react";
import { useApiClient } from "../../lib/ApiClientProvider";
import { ScheduleDateTimePicker, isTimeInPast, shouldSendImmediately } from '../ScheduleDateTimePicker';



export function ContactMessageModal({
    contact,
    message,
    isOpen,
    setIsOpen,
}: {
    contact: Contact;
    message?: Schedule;
    isOpen: boolean;
    setIsOpen: (value: boolean) => void;
}) {
    const isEditMode = !!message;
    const client = useApiClient();
    const queryClient = useQueryClient();

    Logger.debug(`Rendering ContactMessageModal`, {
        component: "ContactMessageModal",
        data: {
            contactId: contact.id,
            contactName: `${contact.first_name} ${contact.last_name}`,
            messageId: message?.id,
            isOpen,
            isEditMode
        }
    });

    const createSchedule = useCreateScheduleMutation(client);
    const updateSchedule = useUpdateScheduleMutation(client);
    const { data: queryTemplates } = useQuery(getAllTemplatesQueryOptions(client));
    const templates = queryTemplates || [];
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [errorMessage, setErrorMessage] = useState<string>("");


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

    const form = useForm({
        defaultValues: {
            text: message?.text || "",
            scheduled_time: message
                ? dayjs(message.scheduled_time).toISOString()
                : dayjs().add(Number(import.meta.env.VITE_MIN_MESSAGE_DELAY || 5), 'minute').toISOString(),
            template_id: message?.template?.toString() || "",
        },
        onSubmit: async ({ value }) => {
            setIsSubmitting(true);
            setErrorMessage(""); // Clear any previous errors

            Logger.debug("Form submitted", {
                component: "ContactMessageModal",
                data: {
                    contactId: contact.id,
                    messageId: message?.id,
                    scheduled_time: value.scheduled_time,
                    template_id: value.template_id,
                    textLength: value.text.length,
                    shouldSendImmediately: shouldSendImmediately(value.scheduled_time),
                    isEditMode
                }
            });

            try {
                // Validate required fields
                if (!value.template_id && !value.text.trim()) {
                    Logger.warn('Either template or text is required', { component: 'ContactMessageModal' });
                    return;
                }

                // Use the actual text from the form (which could be template text or custom/edited text)
                const messageText = value.text.trim();

                if (isEditMode && message) {
                    // Update existing message
                    Logger.info("Updating message", {
                        component: "ContactMessageModal",
                        data: { messageId: message.id }
                    });

                    const updateData: UpdateSchedule = {
                        id: message.id,
                        contact_id: message.contact ?? undefined,
                        scheduled_time: new Date(value.scheduled_time).toISOString(),
                        template_id: value.template_id ? parseInt(value.template_id) : undefined,
                        text: messageText,
                    };

                    await updateSchedule.mutateAsync(updateData);

                    Logger.info("Message updated successfully", {
                        component: "ContactMessageModal",
                        data: { messageId: message.id }
                    });
                } else if (shouldSendImmediately(value.scheduled_time)) {
                    // Send immediate message
                    Logger.info("Sending immediate message", {
                        component: "ContactMessageModal",
                        data: { contactId: contact.id }
                    });

                    const smsProps: SendSmsRequest = {
                        message: messageText,
                        recipients: [{ phone: contact.phone, contact_id: contact.id }],
                    };

                    await sendSms(client, smsProps);

                    // Invalidate schedules cache to refresh the table
                    queryClient.invalidateQueries({
                        queryKey: ['schedules', 'contact', contact.id]
                    });

                    Logger.info("Immediate message sent successfully", {
                        component: "ContactMessageModal",
                        data: { contactId: contact.id }
                    });
                } else {
                    // Create scheduled message
                    Logger.info("Creating scheduled message", {
                        component: "ContactMessageModal",
                        data: { contactId: contact.id }
                    });

                    const newScheduleProps: CreateSchedule = {
                        contact_id: contact.id,
                        phone: contact.phone,
                        scheduled_time: new Date(value.scheduled_time).toISOString(),
                        template_id: value.template_id ? parseInt(value.template_id) : undefined,
                        text: messageText,
                    };

                    await createSchedule.mutateAsync(newScheduleProps);

                    // Invalidate schedules cache to refresh the table
                    queryClient.invalidateQueries({
                        queryKey: ['schedules', 'contact', contact.id]
                    });

                    Logger.info("Scheduled message created successfully", {
                        component: "ContactMessageModal",
                        data: { contactId: contact.id }
                    });
                }

                // Close modal after successful operation
                setErrorMessage(""); // Clear any error state
                setIsOpen(false);
                form.reset();
            } catch (error) {
                const errorMsg = extractErrorMessage(error);
                setErrorMessage(errorMsg);

                Logger.error("Failed to process message", {
                    component: "ContactMessageModal",
                    data: {
                        contactId: contact.id,
                        messageId: message?.id,
                        error: error instanceof Error ? error.message : String(error),
                        extractedError: errorMsg,
                        wasImmediate: shouldSendImmediately(value.scheduled_time),
                        isEditMode
                    }
                });
            } finally {
                setIsSubmitting(false);
            }
        },
    });


    const handleMessageChange = (e: React.ChangeEvent<HTMLTextAreaElement>, field: any) => {
        const newValue = e.target.value;
        const currentTemplateId = form.getFieldValue('template_id');

        Logger.debug("Message text changed", {
            component: "ContactMessageModal",
            data: {
                textLength: newValue.length,
                truncated: newValue.length > Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH),
                currentTemplateId
            }
        });

        // Check if we have a template selected and text has changed from original
        if (currentTemplateId && templates) {
            const originalTemplate = templates.find((t: any) => t.id.toString() === currentTemplateId);
            const originalText = originalTemplate?.text || '';

            // If text differs from original template, switch to custom message
            if (newValue !== originalText) {
                form.setFieldValue('template_id', '');
                Logger.debug("Template text modified, switching to custom message", {
                    component: "ContactMessageModal",
                    data: {
                        originalLength: originalText.length,
                        newLength: newValue.length
                    }
                });
            }
        }

        // Handle length limit and set field value
        if (newValue.length > Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH)) {
            field.handleChange(newValue.substring(0, Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH)));
        } else {
            field.handleChange(newValue);
        }
    };

    const [currentScheduledTime, setCurrentScheduledTime] = useState(form.getFieldValue('scheduled_time'));
    const isPastTime = Boolean(currentScheduledTime && isTimeInPast(currentScheduledTime));

    return (
        <Dialog
            open={isOpen}
            onClose={() => {
                return false;
            }}
        >
            <DialogTitle>
                {isEditMode ? 'Edit Message' : `Create new message for ${contact.first_name} ${contact.last_name}`}
            </DialogTitle>
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
                <form
                    id="create-message-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        Logger.debug("Form onSubmit triggered", {
                            component: "ContactMessageModal"
                        });
                        form.handleSubmit();
                    }}
                >
                    <form.Field
                        name="scheduled_time"
                        validators={{
                            onSubmit: ({ value }) => {
                                if (!value) {
                                    return "Please select a date and time";
                                }
                            },
                        }}
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
                                <Label>Select Template (Optional)</Label>
                                <Select
                                    name={field.name}
                                    value={field.state.value}
                                    onChange={(e) => {
                                        const newTemplateId = e.target.value;
                                        const previousTemplateId = field.state.value;

                                        field.handleChange(newTemplateId);

                                        if (newTemplateId) {
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
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>Message *</Label>
                                <Textarea
                                    name={field.name}
                                    placeholder="Enter your message or select a template to edit..."
                                    rows={6}
                                    autoFocus
                                    autoComplete="off"
                                    invalid={field.state.meta.errors.length > 0}
                                    value={field.state.value}
                                    onChange={(e) => handleMessageChange(e, field)}
                                />
                                <div className="text-sm text-zinc-500 mt-1 text-right">
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
                        )}
                    />
                    <DialogActions>
                        <Button
                            outline
                            onClick={() => {
                                Logger.debug("Cancel button clicked", {
                                    component: "ContactMessageModal"
                                });
                                setErrorMessage(""); // Clear error when canceling
                                setIsOpen(false);
                                form.reset();
                            }}
                        >
                            Cancel
                        </Button>
                        <Button
                            type="submit"
                            form="create-message-form"
                            color="emerald"
                            disabled={isSubmitting || isPastTime}
                            onClick={() => {
                                Logger.debug(`${isEditMode ? 'Update' : 'Create'} button clicked`, {
                                    component: "ContactMessageModal",
                                    data: {
                                        template_id: form.getFieldValue('template_id'),
                                        textLength: form.getFieldValue('text').length,
                                        isEditMode
                                    }
                                });
                            }}
                        >
                            {isSubmitting ? (
                                <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                            ) : (isEditMode ? "Update" : "Create")}
                        </Button>
                    </DialogActions>
                </form>
            </DialogBody>
        </Dialog>
    );
}
