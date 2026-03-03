import { createFileRoute } from '@tanstack/react-router'
import {
  Field,
  FieldGroup,
  Fieldset,
  Label,
  Legend,
} from '../../ui/fieldset'
import { Textarea } from '../../ui/textarea'
import { Select } from '../../ui/select'
import { useState, useEffect, Suspense, useRef } from 'react'
import { Button } from '../../ui/button'
import { Dialog, DialogActions, DialogBody, DialogTitle } from '../../ui/dialog'
import { getAllTemplatesQueryOptions } from '../../api/templatesApi'
import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { sendSms, sendMms, uploadImageFile } from '../../api/smsApi'
import { useForm } from '@tanstack/react-form'
import {
  Combobox,
  ComboboxInput,
  ComboboxOption,
  ComboboxOptions,
} from '@headlessui/react'
import { XMarkIcon } from '@heroicons/react/20/solid'
import { getSearchContactsQueryOptions } from '../../api/contactsApi'
import { getAllGroupsQueryOptions, getSearchInGroupsQueryOptions, getGroupByIdQueryOptions } from '../../api/groupsApi'
import type { Contact } from '../../types/contact.types'
import type { ContactGroup } from '../../types/group.types'
import LoadingSpinner from '../../components/shared/LoadingSpinner'
import Logger from '../../utils/logger'
import { FileUpload } from '../../ui/file-upload'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/send')({
  component: Send,
})

function SendContent() {
  const client = useApiClient()
  const { data: templates } = useSuspenseQuery(getAllTemplatesQueryOptions(client))
  const [query, setQuery] = useState('')
  const [groupQuery, setGroupQuery] = useState('')
  const [debouncedQuery, setDebouncedQuery] = useState('')
  const [debouncedGroupQuery, setDebouncedGroupQuery] = useState('')
  const contactsQuery = useQuery(getSearchContactsQueryOptions(client, debouncedQuery))
  const groupsQuery = useQuery(getSearchInGroupsQueryOptions(client, debouncedGroupQuery))
  const [contacts, setContacts] = useState<Contact[]>([])
  const [searchGroups, setSearchGroups] = useState<ContactGroup[]>([])
  const [inputValue, setInputValue] = useState('')

  const [isSending, setIsSending] = useState(false)
  const [selectedGroupId, setSelectedGroupId] = useState<number | null>(null)
  type SelectedRecipient = { phone: string; name?: string; contactId?: number }
  const [selectedRecipients, setSelectedRecipients] = useState<SelectedRecipient[]>([])
  const [pendingGroupToExpand, setPendingGroupToExpand] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState<string>('')
  const recipientInputRef = useRef<HTMLInputElement | null>(null)
  const chipsContainerRef = useRef<HTMLDivElement | null>(null)
  const [summaryOpen, setSummaryOpen] = useState(false)
  const [summaryCounts, setSummaryCounts] = useState({ total: 0, success: 0, error: 0, errors: [] as string[] })

  const [uploadedFileUrl, setUploadedFileUrl] = useState<string | null>(null)
  const [uploadingFile, setUploadingFile] = useState(false)
  const [uploadError, setUploadError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<File | null>(null)
  const [fileUploadKey, setFileUploadKey] = useState<number>(0)

  const extractErrorMessage = (error: any): string => {
    if (error?.detail) return error.detail
    if (error?.message) return error.message
    return 'An unexpected error occurred. Please try again.'
  }

  const { data: selectedGroupDetails } = useQuery({
    ...getGroupByIdQueryOptions(client, selectedGroupId!, 1, 10000),
    enabled: !!selectedGroupId,
  })

  useEffect(() => {
    if (!contactsQuery.isFetching && contactsQuery.data) {
      setContacts(contactsQuery.data)
    }
  }, [contactsQuery.data, contactsQuery.isFetching])

  useEffect(() => {
    if (!groupsQuery.isFetching && groupsQuery.data) {
      setSearchGroups(groupsQuery.data)
    }
  }, [groupsQuery.data, groupsQuery.isFetching])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedQuery(query)
    }, 350)
    return () => clearTimeout(timeoutId)
  }, [query])

  useEffect(() => {
    const timeoutId = setTimeout(() => {
      setDebouncedGroupQuery(groupQuery)
    }, 350)
    return () => clearTimeout(timeoutId)
  }, [groupQuery])

  const normalizePhone = (phone: string) => phone.replace(/\D/g, '')
  const isValidMobile = (raw: string) => /^04\d{8}$/.test(normalizePhone(raw))
  const isDuplicatePhone = (phone: string) => {
    const normalized = normalizePhone(phone)
    return selectedRecipients.some((r) => normalizePhone(r.phone) === normalized)
  }
  const addRecipientByPhone = (phone: string, name?: string, contactId?: number) => {
    if (!phone) return
    if (isDuplicatePhone(phone)) return
    setSelectedRecipients((prev) => [...prev, { phone, name, contactId }])
  }
  const addContactRecipient = (contact: Contact) => {
    addRecipientByPhone(contact.phone, `${contact.first_name} ${contact.last_name}`, contact.id)
  }
  const addGroupRecipients = (groupId: number) => {
    setPendingGroupToExpand(groupId)
    setSelectedGroupId(groupId)
  }

  const handleFileSelect = async (file: File) => {
    setSelectedFile(file)
    setUploadError(null)
    setUploadedFileUrl(null)
    setUploadingFile(true)

    try {
      const response = await uploadImageFile(client, file)
      setUploadedFileUrl(response.url || null)
    } catch (error) {
      const errorMsg = extractErrorMessage(error)
      setUploadError(errorMsg)
      setSelectedFile(null)
    } finally {
      setUploadingFile(false)
    }
  }

  const handleFileRemove = () => {
    setSelectedFile(null)
    setUploadedFileUrl(null)
    setUploadError(null)
  }

  useEffect(() => {
    if (pendingGroupToExpand && selectedGroupDetails && selectedGroupDetails.id === pendingGroupToExpand) {
      const members = selectedGroupDetails.members || []
      members.forEach((m: any) => {
        if (m.first_name && m.phone) {
          addRecipientByPhone(m.phone, `${m.first_name} ${m.last_name}`, m.id)
        }
      })
      setPendingGroupToExpand(null)
      setInputValue('')
      setQuery('')
    }
  }, [pendingGroupToExpand, selectedGroupDetails])

  useEffect(() => {
    if (chipsContainerRef.current) {
      chipsContainerRef.current.scrollTop = chipsContainerRef.current.scrollHeight
    }
  }, [selectedRecipients.length])

  const templatesSelectOptions = templates.map((entry) => (
    <option key={entry.id} value={entry.id.toString()}>
      {entry.name}
    </option>
  ))

  const form = useForm({
    defaultValues: {
      recipient: null as Contact | undefined | null,
      text: '',
      templateId: '',
    },
    onSubmit: async ({ value }) => {
      setIsSending(true)
      setErrorMessage('')
      try {
        if (!value.templateId && !value.text.trim() && !uploadedFileUrl) {
          const errorMsg = import.meta.env.VITE_ENABLE_MMS === 'true'
            ? 'Please select a template, enter a custom message, or upload an image'
            : 'Please select a template or enter a custom message'
          setErrorMessage(errorMsg)
          return
        }

        let messageText = ''
        if (value.templateId && templates) {
          const selectedTemplate = templates.find((template) => template.id.toString() === value.templateId)
          messageText = selectedTemplate?.text || ''
        } else {
          messageText = value.text.trim()
        }

        if (!messageText && !uploadedFileUrl) {
          messageText = value.text.trim()
        }

        if (selectedRecipients.length === 0 && !value.recipient && !inputValue) {
          return 'Please select a recipient or enter the phone number'
        }

        const recipientsList: SelectedRecipient[] = selectedRecipients.length > 0
          ? selectedRecipients
          : [{ phone: value?.recipient?.phone ?? inputValue, name: value?.recipient ? `${value.recipient.first_name} ${value.recipient.last_name}` : undefined, contactId: value.recipient?.id ?? undefined }]

        let successCount = 0
        let errorCount = 0
        const errorMessages: string[] = []
        for (const r of recipientsList) {
          try {
            if (uploadedFileUrl) {
              await sendMms(client, {
                message: messageText,
                recipient: r.phone,
                contact_id: r.contactId ?? null,
                media_url: uploadedFileUrl,
              })
            } else {
              await sendSms(client, {
                message: messageText,
                recipient: r.phone,
                contact_id: r.contactId ?? null,
              })
            }
            successCount += 1
          } catch (e) {
            errorCount += 1
            const errorMsg = extractErrorMessage(e)
            errorMessages.push(errorMsg)
          }
        }

        setErrorMessage('')
        setInputValue('')
        setSelectedRecipients([])
        form.reset()
        setUploadedFileUrl(null)
        setSelectedFile(null)
        setUploadError(null)
        setFileUploadKey((prev) => prev + 1)
        setSummaryCounts({ total: recipientsList.length, success: successCount, error: errorCount, errors: errorMessages })
        setSummaryOpen(true)
      } catch (error) {
        const errorMsg = extractErrorMessage(error)
        setErrorMessage(errorMsg)
      } finally {
        setIsSending(false)
      }
    },
  })

  return (
    <div className="flex justify-center">
      <Fieldset className="max-w-[600px] flex-1 border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg overflow-y-auto max-h-[calc(100vh-120px)]">
        <Legend>Send Message</Legend>
        <FieldGroup>
          {errorMessage && (
            <div className="mb-4 p-3 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-md">
              <div className="flex items-center">
                <div className="flex-shrink-0">
                  <svg className="h-5 w-5 text-red-400" viewBox="0 0 20 20" fill="currentColor">
                    <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd" />
                  </svg>
                </div>
                <div className="ml-3">
                  <h3 className="text-sm font-medium text-red-800 dark:text-red-200">Error</h3>
                  <div className="mt-1 text-sm text-red-700 dark:text-red-300">{errorMessage}</div>
                </div>
              </div>
            </div>
          )}
          <form
            onSubmit={(e) => {
              e.preventDefault()
              e.stopPropagation()
              form.handleSubmit()
            }}
            className="space-y-4"
          >
            {
              <form.Field
                name="recipient"
                children={(field) => (
                  <Field>
                    <Label className="block mb-2">To</Label>
                    <div className="w-full rounded-lg border border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 px-2 py-1.5 text-sm h-24 flex flex-col">
                      {selectedRecipients.length > 0 && (
                        <div ref={chipsContainerRef} className="flex flex-wrap gap-2 mb-1 pr-1 overflow-y-auto max-h-16">
                          {selectedRecipients.map((r, idx) => (
                            <span key={`${r.phone}-${idx}`} className="inline-flex items-center gap-1 rounded-md bg-emerald-50 dark:bg-emerald-950/30 text-emerald-900 dark:text-emerald-200 px-2 py-0.5 border border-emerald-200 dark:border-emerald-800">
                              <span className="truncate max-w-[200px]">{r.name ? r.name : r.phone}</span>
                              <button type="button" className="text-emerald-800 hover:text-emerald-900" onClick={() => setSelectedRecipients((prev) => prev.filter((_, i) => i !== idx))}>
                                <XMarkIcon className="size-4" />
                              </button>
                            </span>
                          ))}
                        </div>
                      )}
                      <Combobox
                        value={null}
                        onChange={(value: any) => {
                          if (!value) return
                          if (value.__type === 'contact') {
                            addContactRecipient(value.data as Contact)
                          } else if (value.__type === 'group') {
                            addGroupRecipients((value.data as ContactGroup).id)
                          }
                          setInputValue('')
                          field.handleChange(null)
                          if (recipientInputRef.current) recipientInputRef.current.value = ''
                        }}
                      >
                        <div className="relative">
                          <ComboboxInput
                            ref={recipientInputRef}
                            className="w-full bg-transparent px-1 outline-none text-zinc-950 dark:text-white"
                            onKeyDown={(e) => {
                              if ((e.key === 'Enter' || e.key === ',' || e.key === 'Tab') && inputValue.trim().length > 0) {
                                e.preventDefault()
                                const candidate = inputValue.trim()
                                if (isValidMobile(candidate)) {
                                  const normalized = normalizePhone(candidate)
                                  addRecipientByPhone(normalized)
                                  setInputValue('')
                                  setQuery('')
                                  setGroupQuery('')
                                  setContacts([])
                                  setSearchGroups([])
                                  field.handleChange(null)
                                  if (recipientInputRef.current) recipientInputRef.current.value = ''
                                }
                              }
                            }}
                            onChange={(event) => {
                              const newValue = event.target.value
                              setInputValue(newValue)
                              if (newValue.length >= 2) {
                                setQuery(newValue)
                                setGroupQuery(newValue)
                              } else {
                                setQuery('')
                                setGroupQuery('')
                                setContacts([])
                                setSearchGroups([])
                              }
                              field.handleChange(null)
                            }}
                            displayValue={() => inputValue}
                            placeholder="Start typing a phone number, name or list name"
                            autoComplete="off"
                          />
                          {(contactsQuery.isFetching || groupsQuery.isFetching) && (
                            <div className="absolute right-2 top-1/2 transform -translate-y-1/2">
                              <div className="h-4 w-4 animate-spin rounded-full border-2 border-zinc-400 border-t-transparent" />
                            </div>
                          )}
                          {(contacts.length > 0 || searchGroups.length > 0) && (
                            <ComboboxOptions className="absolute z-50 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white dark:bg-zinc-900 py-0.5 shadow-lg border border-zinc-950/10 dark:border-white/10">
                              {contacts.length > 0 && (
                                <div>
                                  {contacts.map((contact) => (
                                    <ComboboxOption
                                      key={`c-${contact.id}`}
                                      value={{ __type: 'contact', data: contact }}
                                      className={({ focus }) => `cursor-default select-none py-1.5 pl-3 pr-4 text-sm ${focus ? 'bg-zinc-50 dark:bg-zinc-800' : ''}`}
                                      disabled={isDuplicatePhone(contact.phone)}
                                    >
                                      {`${contact.first_name} ${contact.last_name} - ${contact.phone.replace(/(\d{4})(\d{3})(\d{3})/, '$1 $2 $3')}`}
                                    </ComboboxOption>
                                  ))}
                                </div>
                              )}
                              {searchGroups.length > 0 && (
                                <div className="border-t border-zinc-200 dark:border-zinc-700 mt-1 pt-1">
                                  {searchGroups.map((group) => (
                                    <ComboboxOption
                                      key={`g-${group.id}`}
                                      value={{ __type: 'group', data: group }}
                                      className={({ focus }) => `cursor-default select-none py-1.5 pl-3 pr-4 text-sm ${focus ? 'bg-zinc-50 dark:bg-zinc-800' : ''}`}
                                    >
                                      {group.name} {group.member_count !== undefined ? `(${group.member_count})` : ''}
                                    </ComboboxOption>
                                  ))}
                                </div>
                              )}
                            </ComboboxOptions>
                          )}
                        </div>
                      </Combobox>
                    </div>
                    <div className="text-right text-sm text-zinc-500 mt-1">Recipients: {selectedRecipients.length}</div>
                    {field.state.meta.errors && (
                      <div className="mt-1 text-sm text-red-500">{field.state.meta.errors}</div>
                    )}
                  </Field>
                )}
              />
            }

            <form.Field
              name="templateId"
              children={(field) => (
                <Field>
                  <Label className="block mb-2">Select Template (Optional)</Label>
                  <Select
                    className="mt-0"
                    name={field.name}
                    value={field.state.value}
                    onChange={(e) => {
                      const newTemplateId = e.target.value
                      field.handleChange(newTemplateId)
                      if (newTemplateId) {
                        const selectedTemplate = templates?.find(
                          (template) => template.id.toString() === newTemplateId,
                        )
                        if (selectedTemplate?.text) {
                          form.setFieldValue('text', selectedTemplate.text)
                        }
                      }
                    }}
                  >
                    <option value="">Custom message</option>
                    {templatesSelectOptions}
                  </Select>
                </Field>
              )}
            />

            <form.Field
              name="text"
              children={(field) => (
                <Field>
                  <Label className="block mb-2">Message *</Label>
                  <Textarea
                    name={field.name}
                    rows={6}
                    placeholder="Enter your message or select a template to edit..."
                    value={field.state.value}
                    onChange={(e) => {
                      const newValue = e.target.value
                      const currentTemplateId = form.getFieldValue('templateId')

                      if (currentTemplateId && templates) {
                        const originalTemplate = templates.find((t) => t.id.toString() === currentTemplateId)
                        const originalText = originalTemplate?.text || ''
                        if (newValue !== originalText) {
                          form.setFieldValue('templateId', '')
                        }
                      }

                      if (newValue.length > Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH)) {
                        field.handleChange(newValue.substring(0, Number(import.meta.env.VITE_MAX_TEMPLATE_LENGTH)))
                      } else {
                        field.handleChange(newValue)
                      }
                    }}
                  />
                </Field>
              )}
            />

            {import.meta.env.VITE_ENABLE_MMS === 'true' && (
              <Field>
                <Label className="block mb-2">Image Upload (Optional)</Label>
                <FileUpload
                  key={fileUploadKey}
                  onFileSelect={handleFileSelect}
                  onFileRemove={handleFileRemove}
                  accept=".png,.jpg,.jpeg,.gif"
                  disabled={uploadingFile}
                  maxSize={400 * 1024}
                />
                {uploadingFile && (
                  <div className="mt-2 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-blue-600 border-t-transparent" />
                    Uploading image...
                  </div>
                )}
                {uploadError && (
                  <div className="mt-2 p-2 bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg">
                    <div className="text-sm text-red-600 dark:text-red-400">Upload failed: {uploadError}</div>
                  </div>
                )}
              </Field>
            )}

            <div className="text-sm text-zinc-500 mt-4 text-right">
              <form.Subscribe
                selector={(state) => ({ templateId: state.values.templateId, text: state.values.text })}
                children={({ templateId, text }) => {
                  let textToCount = ''
                  const maxLength = parseInt(import.meta.env.VITE_MAX_TEMPLATE_LENGTH) || 320

                  if (templateId && templates) {
                    const selectedTemplate = templates.find(
                      (template) => template.id.toString() === templateId,
                    )
                    textToCount = selectedTemplate?.text || ''
                  } else {
                    textToCount = text || ''
                  }

                  const messageTypePrefix = uploadedFileUrl ? 'MMS' : 'SMS'

                  return (
                    <>
                      <div>
                        {messageTypePrefix} - Characters: {textToCount.length} / {maxLength}
                      </div>
                      <div>
                        {uploadedFileUrl
                          ? `${messageTypePrefix} - Message parts: 1 / 1`
                          : `${messageTypePrefix} - Message parts: ${textToCount.length === 0 ? '0' : textToCount.length > 160 ? '2' : '1'} / 2`}
                      </div>
                    </>
                  )
                }}
              />
            </div>

            <div className="flex justify-end mt-4">
              <Button type="submit" color="emerald" disabled={isSending}>
                {isSending ? (
                  <div className="flex items-center gap-2">
                    <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                    {'Sending...'}
                  </div>
                ) : (
                  'Send'
                )}
              </Button>
            </div>
          </form>
        </FieldGroup>
      </Fieldset>
      {summaryOpen && (
        <Dialog open={summaryOpen} onClose={setSummaryOpen} size="sm">
          <DialogTitle>Send summary</DialogTitle>
          <DialogBody>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between">
                <span>Total recipients</span>
                <span>{summaryCounts.total}</span>
              </div>
              <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                <span>Successful</span>
                <span>{summaryCounts.success}</span>
              </div>
              <div className="flex justify-between text-red-700 dark:text-red-400">
                <span>Unsuccessful</span>
                <span>{summaryCounts.error}</span>
              </div>
              {summaryCounts.errors.length > 0 && (
                <div className="mt-4 pt-2 border-t border-zinc-200 dark:border-zinc-700">
                  <div className="text-sm font-medium text-red-700 dark:text-red-400 mb-2">Error Messages:</div>
                  <div className="space-y-1">
                    {summaryCounts.errors.map((error, index) => (
                      <div key={index} className="text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-950/20 p-2 rounded border border-red-200 dark:border-red-800">
                        {error}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </DialogBody>
          <DialogActions>
            <Button color="emerald" onClick={() => setSummaryOpen(false)}>
              Close
            </Button>
          </DialogActions>
        </Dialog>
      )}
    </div>
  )
}

function Send() {
  return (
    <Suspense fallback={<LoadingSpinner />}>
      <SendContent />
    </Suspense>
  )
}
