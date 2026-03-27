import type { Contact, CreateContact } from "../../types/contact.types";
import {
    Dialog,
    DialogActions,
    DialogBody,
    DialogTitle,
} from "../../ui/dialog";
import { ErrorMessage, Field, Label } from "../../ui/fieldset";
import { Input } from "../../ui/input";
import { Button } from "../../ui/button";
import {
    useCreateContactMutation,
    useUpdateContactMutation,
} from "../../api/contactsApi";
import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import Logger from "../../utils/logger";
import { useState } from "react";
import { useApiClient } from "../../lib/ApiClientProvider";
import { toast } from "sonner";

function formatPhoneNumber(value: string): string {
    const cleaned = value.replace(/\D/g, "");
    const limited = cleaned.substring(0, 10);

    if (limited.length <= 4) {
        return limited;
    }
    if (limited.length < 7) {
        return `${limited.substring(0, 4)} ${limited.substring(4)}`;
    }
    return `${limited.substring(0, 4)} ${limited.substring(4, 7)} ${limited.substring(7)}`;
}

export function ContactModal({
    contact,
    isOpen,
    setIsOpen,
}: {
    contact?: Contact;
    isOpen: boolean;
    setIsOpen: (value: boolean) => void;
}) {
    const [error, setError] = useState<string | null>(null);
    const client = useApiClient();

    Logger.debug("Rendering ContactModal", {
        component: "ContactModal",
        data: {
            contactId: contact?.id,
            isOpen,
            mode: contact ? "edit" : "create"
        }
    });

    const navigate = useNavigate();
    const createContact = useCreateContactMutation(client);
    const updateContact = useUpdateContactMutation(client);

    const heading = contact ? "Edit contact details" : "Add new contact";
    const buttonText = contact ? "Update" : "Create";

    const form = useForm({
        defaultValues: {
            first_name: contact?.first_name || "",
            last_name: contact?.last_name || "",
            phone: contact?.phone ? formatPhoneNumber(contact.phone) : "",
        },
        onSubmit: ({ value }) => {
            setError(null);
            Logger.debug("Form submitted", {
                component: "ContactModal",
                data: {
                    first_name: value.first_name.trim(),
                    last_name: value.last_name.trim(),
                    phoneLength: value.phone.length
                }
            });

            const cleanedPhone = value.phone.replace(/\D/g, "");
            if (contact) {
                const updateData: Contact = {
                    ...contact,
                    first_name: value.first_name,
                    last_name: value.last_name,
                    phone: cleanedPhone,
                };

                Logger.info("Updating contact", {
                    component: "ContactModal",
                    data: { contactId: contact.id }
                });

                updateContact.mutate(updateData, {
                    onSuccess: (updatedContact) => {
                        Logger.info("Contact updated successfully", {
                            component: "ContactModal",
                            data: { contactId: updatedContact.id }
                        });
                        toast.success("Contact updated");
                        setIsOpen(false);
                        form.reset();
                    },
                    onError: (error) => {
                        Logger.error("Failed to update contact", {
                            component: "ContactModal",
                            data: {
                                contactId: contact.id,
                                error
                            }
                        });
                        toast.error("Failed to update contact");
                        setError(error.message);
                    },
                    onSettled: () => {
                    },
                });
            } else {
                const newContact: CreateContact = {
                    first_name: value.first_name,
                    last_name: value.last_name,
                    phone: cleanedPhone,
                };

                Logger.info("Creating new contact", {
                    component: "ContactModal",
                    data: {
                        first_name: value.first_name,
                        last_name: value.last_name
                    }
                });

                createContact.mutate(newContact, {
                    onSuccess: (newContact) => {
                        Logger.info("Contact created successfully", {
                            component: "ContactModal",
                            data: { contactId: newContact.id }
                        });
                        toast.success("Contact created");
                        navigate({
                            to: "/app/contacts/$contactId",
                            params: { contactId: newContact.id },
                        });
                        setIsOpen(false);
                        form.reset();
                    },
                    onError: (error) => {
                        Logger.error("Failed to create contact", {
                            component: "ContactModal",
                            data: { error: error }
                        });
                        toast.error("Failed to create contact");
                        setError(error.message);
                    },
                    onSettled: () => {
                    },
                });
            }
        },
    });

    const handlePhoneChange = (
        e: React.ChangeEvent<HTMLInputElement>,
        field: any
    ) => {
        // Remove all non-digit characters
        if (!/^\d*$/.test(e.target.value.replace(/\s/g, ""))) {
            return;
        }

        const input = e.target;
        const currentValue = input.value;
        const cursorPosition = input.selectionStart || 0;
        const isBackspace = currentValue.length < field.state.value.length;

        Logger.debug("Processing phone number change", {
            component: "ContactModal.handlePhoneChange",
            data: { currentValue, cursorPosition }
        });

        // Get clean digit count of current value
        const currentDigits = field.state.value.replace(/\D/g, "");
        const newValueDigits = currentValue.replace(/\D/g, "");

        if (
            currentDigits.length >= 10 &&
            newValueDigits.length > 10 &&
            !isBackspace
        ) {
            return;
        }

        // Format the phone number
        const formattedValue = formatPhoneNumber(currentValue);
        field.handleChange(formattedValue);

        Logger.debug("Formatted phone number", {
            component: "ContactModal.handlePhoneChange",
            data: { formattedValue }
        });

        field.handleChange(formattedValue);

        // Calculate new cursor position
        requestAnimationFrame(() => {
            const addedSpaces =
                formattedValue.substring(0, cursorPosition).split(" ").length - 1;
            const originalSpaces =
                currentValue.substring(0, cursorPosition).split(" ").length - 1;
            const spaceDiff = addedSpaces - originalSpaces;
            const newPosition = cursorPosition + spaceDiff;

            Logger.debug("Updating cursor position", {
                component: "ContactModal.handlePhoneChange",
                data: {
                    addedSpaces,
                    originalSpaces,
                    spaceDiff,
                    newPosition
                }
            });

            input.setSelectionRange(newPosition, newPosition);
        });
    };

    return (
        <Dialog
            open={isOpen}
            onClose={() => {
                return false;
            }}
        >
            <DialogTitle className="text-center">{heading}</DialogTitle>
            <DialogBody>
                {error && (
                    <div className="mb-4 rounded-md bg-red-50 dark:bg-red-950/20 p-4">
                        <div className="flex">
                            <div className="flex-shrink-0">
                                <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                                </svg>
                            </div>
                            <div className="ml-3">
                                <p className="text-sm font-medium text-red-800 dark:text-red-400">{error}</p>
                            </div>
                        </div>
                    </div>
                )}
                <form
                    id="contact-form"
                    onSubmit={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        form.handleSubmit();
                    }}
                >
                    <form.Field
                        name="first_name"
                        validators={{
                            onSubmit: ({ value }) => {
                                if (value.length < 2) {
                                    Logger.warn("First name validation failed", {
                                        component: "ContactModal",
                                        data: { length: value.length }
                                    });
                                    return "First Name has to be at least 2 characters long";
                                }
                            },
                        }}
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>First Name</Label>
                                <Input
                                    name={field.name}
                                    placeholder="First Name"
                                    value={field.state.value}
                                    invalid={field.state.meta.errors.length > 0}
                                    onChange={(e) =>
                                        field.handleChange(e.target.value)
                                    }
                                    autoFocus
                                    autoComplete="off"
                                />
                                {field.state.meta.errors && (
                                    <ErrorMessage>
                                        {field.state.meta.errors}
                                    </ErrorMessage>
                                )}
                            </Field>
                        )}
                    />
                    <form.Field
                        name="last_name"
                        validators={{
                            onSubmit: ({ value }) => {
                                if (value.length < 2) {
                                    Logger.warn("Last name validation failed", {
                                        component: "ContactModal",
                                        data: { length: value.length }
                                    });
                                    return "Last Name has to be at least 2 characters long";
                                }
                            },
                        }}
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>Last Name</Label>
                                <Input
                                    name={field.name}
                                    placeholder="Last Name"
                                    value={field.state.value}
                                    invalid={field.state.meta.errors.length > 0}
                                    onChange={(e) =>
                                        field.handleChange(e.target.value)
                                    }
                                    autoComplete="off"
                                />
                                {field.state.meta.errors && (
                                    <ErrorMessage>
                                        {field.state.meta.errors}
                                    </ErrorMessage>
                                )}
                            </Field>
                        )}
                    />
                    <form.Field
                        name="phone"
                        validators={{
                            onSubmit: ({ value }) => {
                                const australianPhoneNumberPattern =
                                    /^0[45]\d{2} \d{3} \d{3}$/;
                                if (!australianPhoneNumberPattern.test(value)) {
                                    return "Please enter a valid Australian mobile number (format: 04xx xxx xxx)";
                                }
                            },
                        }}
                        children={(field) => (
                            <Field className="mb-2">
                                <Label>Phone</Label>
                                <Input
                                    name={field.name}
                                    placeholder="0412 345 678"
                                    value={field.state.value}
                                    invalid={field.state.meta.errors.length > 0}
                                    onChange={(e) =>
                                        handlePhoneChange(e, field)
                                    }
                                    autoComplete="off"
                                />
                                {field.state.meta.errors && (
                                    <ErrorMessage>
                                        {field.state.meta.errors}
                                    </ErrorMessage>
                                )}
                            </Field>
                        )}
                    />
                </form>
            </DialogBody>
            <DialogActions className="flex justify-end">
                <div className="flex gap-2">
                    <Button
                        outline
                        onClick={() => {
                            Logger.debug("Cancel button clicked", {
                                component: "ContactModal"
                            });
                            setIsOpen(false);
                            setError(null);
                            form.reset();
                        }}
                    >
                        Cancel
                    </Button>
                    <Button
                        type="submit"
                        form="contact-form"
                        color="emerald"
                        disabled={createContact.isPending || updateContact.isPending}
                    >
                        {(createContact.isPending || updateContact.isPending) ? (
                            <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
                        ) : buttonText}
                    </Button>
                </div>
            </DialogActions>
        </Dialog>
    );
}
