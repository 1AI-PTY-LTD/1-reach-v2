import { createFileRoute } from '@tanstack/react-router'
import { useState, useEffect } from 'react'
import * as XLSX from 'xlsx'
import { FileUpload } from '../../ui/file-upload'
import { Button } from '../../ui/button'
import { Fieldset } from '../../ui/fieldset'
import { useSuspenseQuery } from '@tanstack/react-query'
import { getAllGroupsQueryOptions } from '../../api/groupsApi'
import type { ContactGroup } from '../../types/group.types'
import Logger from '../../utils/logger'
import { sendSmsToGroup } from '../../api/smsApi'
import { useApiClient } from '../../lib/ApiClientProvider'

export const Route = createFileRoute('/app/_layout/import/')({
  component: ImportIndex,
})

interface ExcelProcessingState {
  isProcessing: boolean
  error: string | null
  jsonData: any[] | null
  fileName: string | null
  sheetName: string | null
}

interface GroupedData {
  [basePlant: string]: any[]
}

function GroupedDataView({ data, existingGroups }: { data: GroupedData; existingGroups: ContactGroup[] }) {
  const client = useApiClient()
  const [editedGroups, setEditedGroups] = useState<Record<string, string>>({})
  const [sendingState, setSendingState] = useState<Record<string, { isSending: boolean; error: string | null; success: string | null }>>({})

  const maxTemplateLength = parseInt(import.meta.env.VITE_MAX_TEMPLATE_LENGTH) || 306

  const existingGroupNames = new Set(existingGroups.map((group) => group.name.trim()))

  const isGroupExists = (groupName: string): boolean => {
    return existingGroupNames.has(groupName.trim())
  }

  const getExistingGroup = (groupName: string): ContactGroup | undefined => {
    return existingGroups.find((group) => group.name.trim() === groupName.trim())
  }

  const handleSend = async (groupName: string) => {
    const existingGroup = getExistingGroup(groupName)
    if (!existingGroup) {
      setSendingState((prev) => ({
        ...prev,
        [groupName]: { isSending: false, error: 'Group does not exist.', success: null },
      }))
      return
    }

    const message = editedGroups[groupName] ?? getGroupContent(data[groupName])

    if (!message.trim()) {
      setSendingState((prev) => ({
        ...prev,
        [groupName]: { isSending: false, error: 'Message cannot be empty.', success: null },
      }))
      return
    }

    setSendingState((prev) => ({
      ...prev,
      [groupName]: { isSending: true, error: null, success: null },
    }))

    try {
      const response = await sendSmsToGroup(client, { group_id: existingGroup.id, message })
      setSendingState((prev) => ({
        ...prev,
        [groupName]: { isSending: false, error: null, success: `Message sent to ${response.results.successful}/${response.results.total} members.` },
      }))
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred while sending the message.'
      setSendingState((prev) => ({
        ...prev,
        [groupName]: { isSending: false, error: errorMessage, success: null },
      }))
    }
  }

  useEffect(() => {
    const importedGroupNames = Object.keys(data)
    const groupsThatExist = importedGroupNames.filter((groupName) => isGroupExists(groupName))
    const groupsThatDontExist = importedGroupNames.filter((groupName) => !isGroupExists(groupName))

    Logger.debug('Imported groups analysis', {
      component: 'GroupedDataView',
      data: {
        importedGroupCount: importedGroupNames.length,
        groupsThatExist: { count: groupsThatExist.length, names: groupsThatExist },
        groupsThatDontExist: { count: groupsThatDontExist.length, names: groupsThatDontExist },
      },
    })
  }, [data, existingGroups])

  const convertExcelTimeToString = (decimalTime: number): string => {
    const totalMinutes = Math.round(decimalTime * 24 * 60)
    const hours = Math.floor(totalMinutes / 60)
    const minutes = totalMinutes % 60
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`
  }

  const getFieldValue = (row: any, field: string) => {
    const value = row[field]
    if (value === undefined || value === null || value === '') return '-'
    if (field === '__EMPTY_5' && typeof value === 'number' && value > 0 && value < 1) {
      return convertExcelTimeToString(value)
    }
    if (typeof value === 'number') return value.toString()
    return value.toString()
  }

  const getGroupContent = (entries: any[]): string => {
    return entries
      .map((entry) => {
        const driver = getFieldValue(entry, '__EMPTY_3')
        const startTime = getFieldValue(entry, '__EMPTY_5')
        const plant = getFieldValue(entry, '__EMPTY_6')
        return `${driver} @ ${startTime} (${plant})`
      })
      .join('\n')
  }

  const handleGroupChange = (groupName: string, value: string) => {
    setEditedGroups((prev) => ({ ...prev, [groupName]: value }))
  }

  return (
    <div className="space-y-4 max-h-[71vh] overflow-auto">
      {Object.entries(data).map(([groupName, entries]) => {
        const originalContent = getGroupContent(entries)
        const currentValue = editedGroups[groupName] ?? originalContent
        const groupSendingState = sendingState[groupName] || { isSending: false, error: null, success: null }

        const groupExists = isGroupExists(groupName)
        const existingGroup = getExistingGroup(groupName)
        const messageLength = currentValue.length
        const isMessageTooLong = messageLength > maxTemplateLength

        const isError = !groupExists

        return (
          <div key={groupName} className="border border-gray-200 dark:border-gray-700 rounded-lg">
            <div
              className={`pl-4 py-2 rounded-t-lg border-b border-gray-200 dark:border-gray-700 ${
                isError ? 'bg-red-100 dark:bg-red-900/30' : 'bg-green-100 dark:bg-green-900/30'
              }`}
            >
              <div className="flex items-center space-x-3">
                <h3 className={`text-sm font-semibold ${isError ? 'text-red-900 dark:text-red-100' : 'text-green-900 dark:text-green-100'}`}>
                  {groupName}
                </h3>
                <span className="text-xs text-gray-500 dark:text-gray-400 bg-gray-200 dark:bg-gray-700 px-2 py-1 rounded-full">
                  {entries.length} entries
                </span>
                {existingGroup?.member_count !== undefined && (
                  <span className="text-xs text-blue-800 dark:text-blue-200 bg-blue-100 dark:bg-blue-900 px-2 py-1 rounded-full">
                    {existingGroup.member_count} member{existingGroup.member_count !== 1 ? 's' : ''}
                  </span>
                )}
              </div>
            </div>

            <div className="p-4 bg-white dark:bg-gray-800">
              {groupExists ? (
                <>
                  {groupSendingState.success ? (
                    <div
                      className="w-full text-sm font-mono text-gray-600 dark:text-gray-400 p-4 rounded border border-gray-200 dark:border-gray-600 whitespace-pre-wrap bg-gray-100 dark:bg-gray-700"
                      style={{ minHeight: `${Math.max(entries.length * 1.5, 3)}rem` }}
                    >
                      {currentValue}
                    </div>
                  ) : (
                    <textarea
                      value={currentValue}
                      onChange={(e) => handleGroupChange(groupName, e.target.value)}
                      className="w-full text-sm font-mono text-gray-800 dark:text-gray-200 p-4 rounded border border-gray-200 dark:border-gray-600 resize-vertical"
                      rows={entries.length}
                      style={{ minHeight: `${Math.max(entries.length * 1.5, 3)}rem` }}
                    />
                  )}
                  <div className="mt-2 flex justify-between items-center">
                    <div className="text-sm">
                      <span className={`${isMessageTooLong ? 'text-red-600 dark:text-red-400' : 'text-gray-500 dark:text-gray-400'}`}>
                        Characters: {messageLength}/{maxTemplateLength} • Message parts: {messageLength === 0 ? '0' : messageLength > 160 ? '2' : '1'} / 2
                      </span>
                    </div>
                    <Button
                      color="green"
                      onClick={() => handleSend(groupName)}
                      disabled={groupSendingState.isSending || !!groupSendingState.success || isMessageTooLong}
                    >
                      {groupSendingState.isSending ? (
                        <div className="flex items-center gap-2">
                          <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                          Sending...
                        </div>
                      ) : groupSendingState.success ? (
                        'Sent'
                      ) : (
                        'Send'
                      )}
                    </Button>
                  </div>
                  {groupSendingState.error && (
                    <div className="mt-2 text-sm text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                      {groupSendingState.error}
                    </div>
                  )}
                  {groupSendingState.success && (
                    <div className="mt-2 text-sm text-green-600 dark:text-green-400 p-2 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
                      {groupSendingState.success}
                    </div>
                  )}
                </>
              ) : (
                <>
                  <div
                    className="w-full text-sm font-mono text-gray-600 dark:text-gray-400 p-4 rounded border border-gray-200 dark:border-gray-600 whitespace-pre-wrap bg-gray-100 dark:bg-gray-700"
                    style={{ minHeight: `${Math.max(entries.length * 1.5, 3)}rem` }}
                  >
                    {currentValue}
                  </div>
                  <div className="mt-2 text-sm text-red-600 dark:text-red-400 p-2 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
                    The group does not exist in 1Reach. Please check the configuration.
                  </div>
                </>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function ImportIndex() {
  const client = useApiClient()
  const [state, setState] = useState<ExcelProcessingState>({
    isProcessing: false,
    error: null,
    jsonData: null,
    fileName: null,
    sheetName: null,
  })

  const allGroupsQuery = useSuspenseQuery(getAllGroupsQueryOptions(client))

  const transformToGroupedData = (data: any[]): GroupedData => {
    const grouped: GroupedData = {}

    data.forEach((row) => {
      const basePlant = row.__EMPTY_2

      if (
        !basePlant ||
        basePlant === 'BASE PLANT' ||
        basePlant.trim() === '' ||
        basePlant.trim() === 'BASE PLANT' ||
        (typeof basePlant === 'string' && basePlant.toLowerCase().includes('base plant'))
      ) {
        return
      }

      if (!grouped[basePlant]) {
        grouped[basePlant] = []
      }

      grouped[basePlant].push(row)
    })

    return grouped
  }

  const handleFileSelect = async (file: File) => {
    setState((prev) => ({
      ...prev,
      isProcessing: true,
      error: null,
      jsonData: null,
      fileName: file.name,
      sheetName: null,
    }))

    try {
      const arrayBuffer = await file.arrayBuffer()
      const workbook = XLSX.read(arrayBuffer, { type: 'array' })

      if (workbook.SheetNames.length < 2) {
        throw new Error('Excel file must contain at least 2 sheets. Found only ' + workbook.SheetNames.length + ' sheet(s).')
      }

      const secondSheetName = workbook.SheetNames[1]
      const worksheet = workbook.Sheets[secondSheetName]

      if (!worksheet || Object.keys(worksheet).length === 0) {
        throw new Error(`The second sheet "${secondSheetName}" is empty.`)
      }

      const jsonData = XLSX.utils.sheet_to_json(worksheet)

      if (jsonData.length === 0) {
        throw new Error(`Could not read data from the second sheet "${secondSheetName}".`)
      }

      const hasRequiredFields = jsonData.some((row) => row && typeof row === 'object' && '__EMPTY_2' in row && (row as any).__EMPTY_2)

      if (!hasRequiredFields) {
        throw new Error(`Could not read data from 2nd sheet "${secondSheetName}".`)
      }

      setState((prev) => ({
        ...prev,
        isProcessing: false,
        jsonData,
        sheetName: secondSheetName,
        error: null,
      }))
    } catch (error) {
      setState((prev) => ({
        ...prev,
        isProcessing: false,
        error: error instanceof Error ? error.message : 'An unknown error occurred while processing the file.',
      }))
    }
  }

  const handleFileRemove = () => {
    setState({
      isProcessing: false,
      error: null,
      jsonData: null,
      fileName: null,
      sheetName: null,
    })
  }

  return (
    <div className="flex justify-center">
      <Fieldset className="max-w-[600px] flex-1 border rounded-lg p-4 border-zinc-950/10 dark:border-white/10 bg-white dark:bg-zinc-900 shadow-lg">
        <div className="space-y-3">
          <div className="py-2">
            <FileUpload onFileSelect={handleFileSelect} disabled={state.isProcessing} sheetName={state.sheetName || undefined} onFileRemove={handleFileRemove} />
          </div>

          {state.isProcessing && (
            <div className="bg-blue-50 dark:bg-blue-950/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
              <div className="flex items-center">
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-600 mr-3"></div>
                <span className="text-blue-800 dark:text-blue-200">Processing Excel file...</span>
              </div>
            </div>
          )}

          {state.error && (
            <div className="bg-red-50 dark:bg-red-950/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
              <h3 className="text-sm font-medium text-red-800 dark:text-red-200 mb-1">Error Processing File</h3>
              <p className="text-sm text-red-700 dark:text-red-300">{state.error}</p>
            </div>
          )}

          {state.jsonData && <GroupedDataView data={transformToGroupedData(state.jsonData)} existingGroups={allGroupsQuery.data} />}
        </div>
      </Fieldset>
    </div>
  )
}
