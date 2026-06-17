import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import UploadFileModal from '../UploadFileModal'
import { renderWithProviders } from '../../../test/test-utils'
import { server } from '../../../test/handlers'

const BASE_URL = 'http://localhost:8000'

// The real component pulls in Logger which is harmless; nothing else to mock.

function makeCsvFile(name = 'contacts.csv') {
  return new File(['phone,first_name\n0412345678,Alice\n'], name, {
    type: 'text/csv',
  })
}

// The hidden <input type="file"> has no accessible role/label, so grab it by type.
function getFileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement | null
  if (!input) throw new Error('file input not found')
  return input
}

describe('UploadFileModal', () => {
  const defaultProps = {
    isOpen: true,
    setIsOpen: vi.fn(),
  }

  it('renders the file-selection view with instructions', () => {
    renderWithProviders(<UploadFileModal {...defaultProps} />)

    expect(screen.getByText('Select file to upload')).toBeInTheDocument()
    expect(screen.getByText('CSV format')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Choose File' })).toBeInTheDocument()
  })

  it('does not render content when isOpen is false', () => {
    renderWithProviders(<UploadFileModal isOpen={false} setIsOpen={vi.fn()} />)
    expect(screen.queryByText('Select file to upload')).not.toBeInTheDocument()
  })

  it('restricts the file input to .csv files', () => {
    renderWithProviders(<UploadFileModal {...defaultProps} />)
    expect(getFileInput()).toHaveAttribute('accept', '.csv')
  })

  it('shows the selected file name after a file is chosen', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UploadFileModal {...defaultProps} />)

    // No file selected yet — the name span is empty.
    expect(screen.getByText(/Selected File:/)).toBeInTheDocument()

    await user.upload(getFileInput(), makeCsvFile('people.csv'))

    expect(await screen.findByText('people.csv')).toBeInTheDocument()
  })

  it('disables the Upload button until a file is selected', async () => {
    const user = userEvent.setup()
    renderWithProviders(<UploadFileModal {...defaultProps} />)

    const uploadButton = screen.getByRole('button', { name: 'Upload' })
    expect(uploadButton).toBeDisabled()

    await user.upload(getFileInput(), makeCsvFile())

    await waitFor(() => expect(uploadButton).toBeEnabled())
  })

  it('uploads the file and shows the completion view on success', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${BASE_URL}/api/contacts/import/`, () =>
        HttpResponse.json(
          {
            status: 'success',
            message: '2 contacts imported successfully',
            record_count: 2,
            success_count: 2,
            error_count: 0,
            error_records: [],
          },
          { status: 200 },
        ),
      ),
    )

    renderWithProviders(<UploadFileModal {...defaultProps} />)

    await user.upload(getFileInput(), makeCsvFile())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    expect(await screen.findByText('Upload Complete')).toBeInTheDocument()
    expect(screen.getByText('2 contacts imported successfully')).toBeInTheDocument()
    // The file-selection controls are gone once the result view shows.
    expect(screen.queryByText('Select file to upload')).not.toBeInTheDocument()
  })

  it('sends the chosen file to the import endpoint as multipart form data', async () => {
    const user = userEvent.setup()

    // ApiClient.uploadFile builds a FormData and posts it via fetch. jsdom +
    // MSW can't round-trip a multipart File back through request.formData(),
    // so we inspect the outgoing request body directly by spying on fetch —
    // the same approach used in lib/__tests__/helper.test.ts.
    const fetchSpy = vi.spyOn(global, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ status: 'success', message: 'done' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )

    renderWithProviders(<UploadFileModal {...defaultProps} />)

    await user.upload(getFileInput(), makeCsvFile('upload-me.csv'))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await screen.findByText('Upload Complete')

    // Posted to the import endpoint as a multipart upload.
    const [url, init] = fetchSpy.mock.calls[0]
    expect(String(url)).toBe(`${BASE_URL}/api/contacts/import/`)
    expect(init?.method).toBe('POST')

    // The file rides under the "file" field with its original name.
    const body = init?.body as FormData
    expect(body).toBeInstanceOf(FormData)
    const uploaded = body.get('file')
    expect(uploaded).toBeInstanceOf(File)
    expect((uploaded as File).name).toBe('upload-me.csv')

    fetchSpy.mockRestore()
  })

  it('invalidates the contacts query after a successful import', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${BASE_URL}/api/contacts/import/`, () =>
        HttpResponse.json({ status: 'success', message: 'ok' }, { status: 200 }),
      ),
    )

    const { queryClient } = renderWithProviders(<UploadFileModal {...defaultProps} />)
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await user.upload(getFileInput(), makeCsvFile())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    await screen.findByText('Upload Complete')
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['contacts'] })
  })

  it('closes the modal and resets state from the completion view', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()
    server.use(
      http.post(`${BASE_URL}/api/contacts/import/`, () =>
        HttpResponse.json({ status: 'success', message: 'ok' }, { status: 200 }),
      ),
    )

    renderWithProviders(<UploadFileModal isOpen={true} setIsOpen={setIsOpen} />)

    await user.upload(getFileInput(), makeCsvFile())
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    const complete = await screen.findByText('Upload Complete')
    const dialog = complete.closest('div')!
    await user.click(within(dialog).getByRole('button', { name: 'Close' }))

    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('cancels from the selection view without uploading', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()
    renderWithProviders(<UploadFileModal isOpen={true} setIsOpen={setIsOpen} />)

    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('keeps the selection view when the upload fails', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(`${BASE_URL}/api/contacts/import/`, () =>
        HttpResponse.json({ error: 'Bad file' }, { status: 400 }),
      ),
    )

    renderWithProviders(<UploadFileModal {...defaultProps} />)

    await user.upload(getFileInput(), makeCsvFile('bad.csv'))
    await user.click(screen.getByRole('button', { name: 'Upload' }))

    // Error is swallowed (logged), no completion view appears; the form remains.
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Upload' })).toBeEnabled(),
    )
    expect(screen.queryByText('Upload Complete')).not.toBeInTheDocument()
    expect(screen.getByText('Select file to upload')).toBeInTheDocument()
  })
})
