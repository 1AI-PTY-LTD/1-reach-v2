import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Suspense } from 'react'
import { renderWithProviders, screen, waitFor, userEvent, fireEvent } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createGroup, paginate } from '../../test/factories'

// TASK B4 — Render the REAL import route component (src/routes/app/_layout.import.index.tsx).
//
// The component drives a CSV/Excel upload → grouped-data preview → per-group
// "send to group" flow. We render the genuine ImportIndex (named export added to
// the source) and exercise its meaningful branches:
//   - the upload UI (FileUpload dropzone)
//   - the processing + error branches of handleFileSelect
//   - the GroupedDataView preview for an EXISTING group (editable textarea + Send)
//   - the GroupedDataView preview for a NON-existing group (error message)
//   - the import/send action hitting /api/sms/send-to-group/
//   - the send-failure branch surfacing an error
//
// The component reads `useSuspenseQuery(getAllGroupsQueryOptions)` for the list of
// existing groups, so we wrap it in a Suspense boundary in the test (the real
// route does this via its Suspense-capable router shell).

// --- @tanstack/react-router mock --------------------------------------------
// ImportIndex only calls createFileRoute at module scope; it uses no router hooks.
vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => options,
}))

// --- xlsx mock ---------------------------------------------------------------
// The component parses the uploaded file with XLSX.read + XLSX.utils.sheet_to_json.
// We mock both so each test controls the parsed workbook shape and the resulting
// rows deterministically (no real binary parsing in jsdom). `xlsxState` is the
// shared, per-test mutable control surface.
const { xlsxState, mockRead, mockSheetToJson } = vi.hoisted(() => {
  const xlsxState: {
    sheetNames: string[]
    sheets: Record<string, Record<string, unknown>>
    rows: unknown[]
    readError: Error | null
  } = {
    sheetNames: ['Summary', 'Data'],
    sheets: { Summary: { A1: {} }, Data: { A1: {} } },
    rows: [],
    readError: null,
  }
  return {
    xlsxState,
    mockRead: vi.fn(() => {
      if (xlsxState.readError) throw xlsxState.readError
      return { SheetNames: xlsxState.sheetNames, Sheets: xlsxState.sheets }
    }),
    mockSheetToJson: vi.fn(() => xlsxState.rows),
  }
})

vi.mock('xlsx', () => ({
  read: mockRead,
  utils: { sheet_to_json: mockSheetToJson },
}))

// Import the REAL exported component after mocks are wired up.
import { ImportIndex } from '../app/_layout.import.index'

// --- helpers -----------------------------------------------------------------

/** Build a fake .xlsx File whose arrayBuffer() resolves (jsdom File lacks it). */
function makeExcelFile(name = 'plants.xlsx') {
  const file = new File(['binary-content'], name, {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  })
  // jsdom's File doesn't implement arrayBuffer in all versions; ensure it resolves.
  Object.defineProperty(file, 'arrayBuffer', {
    value: () => Promise.resolve(new ArrayBuffer(8)),
    writable: true,
  })
  return file
}

/** Render ImportIndex inside a Suspense boundary and wait for the upload UI. */
async function renderImport() {
  const utils = renderWithProviders(
    <Suspense fallback={<div>loading-suspense</div>}>
      <ImportIndex />
    </Suspense>,
  )
  await waitFor(() => {
    expect(screen.getByText('Upload Excel file')).toBeInTheDocument()
  })
  return utils
}

/** Grab the hidden <input type="file"> rendered by FileUpload. */
function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement
  expect(input).not.toBeNull()
  return input
}

/** Configure what the mocked xlsx parser returns for the next upload. */
function setParsedRows(rows: unknown[], opts: Partial<typeof xlsxState> = {}) {
  xlsxState.sheetNames = opts.sheetNames ?? ['Summary', 'Data']
  xlsxState.sheets = opts.sheets ?? { Summary: { A1: {} }, Data: { A1: {} } }
  xlsxState.rows = rows
  xlsxState.readError = opts.readError ?? null
}

/** A row in the shape ImportIndex expects (grouped by __EMPTY_2 = base plant). */
function plantRow(basePlant: string, driver: string, startTime: string, plant: string) {
  return { __EMPTY_2: basePlant, __EMPTY_3: driver, __EMPTY_5: startTime, __EMPTY_6: plant }
}

describe('ImportIndex — Excel import + group send (B4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset xlsx control surface to a benign default each test.
    setParsedRows([])
  })

  it('renders the upload dropzone UI', async () => {
    await renderImport()

    expect(screen.getByText('Upload Excel file')).toBeInTheDocument()
    expect(
      screen.getByText(/Drag and drop or click to browse/i),
    ).toBeInTheDocument()
    // No preview before any file is selected.
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument()
  })

  it('shows an error when the workbook has fewer than two sheets', async () => {
    const user = userEvent.setup()
    await renderImport()

    setParsedRows([], { sheetNames: ['OnlyOne'], sheets: { OnlyOne: { A1: {} } } })
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByText('Error Processing File')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Excel file must contain at least 2 sheets/i),
    ).toBeInTheDocument()
  })

  it('shows an error when no rows carry the required __EMPTY_2 field', async () => {
    const user = userEvent.setup()
    await renderImport()

    // Rows present, but none have a __EMPTY_2 base-plant key.
    setParsedRows([{ __EMPTY_1: 'header' }, { __EMPTY_4: 'noise' }])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByText('Error Processing File')).toBeInTheDocument()
    })
    expect(
      screen.getByText(/Could not read data from 2nd sheet/i),
    ).toBeInTheDocument()
    // No grouped preview rendered when processing failed.
    expect(screen.queryByText(/entries/)).not.toBeInTheDocument()
  })

  it('renders the grouped-data preview for an EXISTING group with editable content', async () => {
    const user = userEvent.setup()
    await renderImport()

    // 'VIP Customers' matches a group returned by the default groups handler.
    setParsedRows([
      plantRow('VIP Customers', 'Alice', 'Morning', 'Site A'),
      plantRow('VIP Customers', 'Bob', 'Noon', 'Site B'),
    ])
    await user.upload(getFileInput(), makeExcelFile())

    // Group header + entry count appear.
    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('2 entries')).toBeInTheDocument()

    // Existing group → editable textarea seeded with the generated content.
    const textarea = await screen.findByRole('textbox')
    expect(textarea).toHaveValue('Alice @ Morning (Site A)\nBob @ Noon (Site B)')

    // The Send button is enabled for an existing, in-range group.
    const sendButton = screen.getByRole('button', { name: 'Send' })
    expect(sendButton).toBeEnabled()
  })

  it('renders the "group does not exist" branch for an unknown base plant', async () => {
    const user = userEvent.setup()
    await renderImport()

    setParsedRows([plantRow('Mystery Plant', 'Carol', 'Dawn', 'Site Z')])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByText('Mystery Plant')).toBeInTheDocument()
    })
    expect(
      screen.getByText('The group does not exist in 1Reach. Please check the configuration.'),
    ).toBeInTheDocument()
    // The unknown-group branch shows read-only content, not an editable textbox.
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Send' })).not.toBeInTheDocument()
  })

  it('skips BASE PLANT header rows when grouping', async () => {
    const user = userEvent.setup()
    await renderImport()

    setParsedRows([
      plantRow('BASE PLANT', 'header', '-', '-'),
      plantRow('  base plant  ', 'header2', '-', '-'),
      plantRow('VIP Customers', 'Dan', 'Late', 'Site C'),
    ])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })
    // Only the one real group rendered (header rows filtered out).
    expect(screen.queryByText('BASE PLANT')).not.toBeInTheDocument()
    expect(screen.getByText('1 entries')).toBeInTheDocument()
  })

  it('sends the imported content to the matching group via /api/sms/send-to-group/', async () => {
    const user = userEvent.setup()
    let sentBody: any = null
    server.use(
      http.post('http://localhost:8000/api/sms/send-to-group/', async ({ request }) => {
        sentBody = await request.json()
        return HttpResponse.json(
          {
            success: true,
            message: 'queued',
            results: { successful: 3, failed: 0, total: 3 },
            group_name: 'VIP Customers',
            group_schedule_id: 7,
          },
          { status: 202 },
        )
      }),
    )

    await renderImport()

    setParsedRows([plantRow('VIP Customers', 'Eve', 'Early', 'Site D')])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))

    // The request targets the existing group's id (VIP Customers → id 1) with
    // the generated message body.
    await waitFor(() => {
      expect(sentBody).not.toBeNull()
    })
    expect(sentBody.group_id).toBe(1)
    expect(sentBody.message).toBe('Eve @ Early (Site D)')

    // Success summary reflects the API result.
    await waitFor(() => {
      expect(screen.getByText('Message sent to 3/3 members.')).toBeInTheDocument()
    })
    // After a successful send the button flips to "Sent" and disables.
    expect(screen.getByRole('button', { name: 'Sent' })).toBeDisabled()
  })

  it('surfaces an API error when the group send fails', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('http://localhost:8000/api/sms/send-to-group/', () =>
        HttpResponse.json({ detail: 'Insufficient credit balance to send this message.' }, { status: 402 }),
      ),
    )

    await renderImport()

    setParsedRows([plantRow('VIP Customers', 'Finn', 'Dusk', 'Site E')])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Send' }))

    await waitFor(() => {
      expect(
        screen.getByText('Insufficient credit balance to send this message.'),
      ).toBeInTheDocument()
    })
    // Failed send leaves the Send button available to retry (not flipped to Sent).
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
  })

  it('disables Send and shows the over-limit counter when edited content exceeds the SMS max length', async () => {
    const user = userEvent.setup()
    await renderImport()

    setParsedRows([plantRow('VIP Customers', 'Gail', 'Morning', 'Site F')])
    await user.upload(getFileInput(), makeExcelFile())

    const textarea = (await screen.findByRole('textbox')) as HTMLTextAreaElement

    // Overwrite with content beyond SMS_MAX_LENGTH (306). Typing 400 chars via
    // userEvent is slow, so set the controlled value in one shot via a change event.
    const longText = 'x'.repeat(400)
    fireEvent.change(textarea, { target: { value: longText } })

    await waitFor(() => {
      expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    })
    // The character counter reflects the over-limit length.
    expect(screen.getByText(/Characters: 400\/306/)).toBeInTheDocument()
  })

  it('renders multiple groups, distinguishing existing from non-existing', async () => {
    const user = userEvent.setup()
    // Tighten the groups handler so only "VIP Customers" exists.
    server.use(
      http.get('http://localhost:8000/api/groups/', () =>
        HttpResponse.json(paginate([createGroup({ id: 1, name: 'VIP Customers', member_count: 4 })])),
      ),
    )

    await renderImport()

    setParsedRows([
      plantRow('VIP Customers', 'Hank', 'AM', 'Site G'),
      plantRow('Ghost Group', 'Ivy', 'PM', 'Site H'),
    ])
    await user.upload(getFileInput(), makeExcelFile())

    await waitFor(() => {
      expect(screen.getByText('VIP Customers')).toBeInTheDocument()
    })
    expect(screen.getByText('Ghost Group')).toBeInTheDocument()

    // Existing group → one Send button + member-count chip; ghost group → error msg.
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument()
    expect(screen.getByText('4 members')).toBeInTheDocument()
    expect(
      screen.getByText('The group does not exist in 1Reach. Please check the configuration.'),
    ).toBeInTheDocument()
  })
})
