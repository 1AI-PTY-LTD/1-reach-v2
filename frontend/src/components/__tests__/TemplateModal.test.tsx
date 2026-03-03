import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TemplateModal } from '../TemplateModal'
import { createTemplate } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'

describe('TemplateModal', () => {
  const defaultProps = {
    isOpen: true,
    setIsOpen: vi.fn(),
    setSelectedTemplateId: vi.fn(),
  }

  it('renders create mode title when no template provided', () => {
    renderWithProviders(<TemplateModal {...defaultProps} />)
    expect(screen.getByText('Create new template')).toBeInTheDocument()
  })

  it('renders edit mode title when template provided', () => {
    const template = createTemplate({ name: 'My Template' })
    renderWithProviders(<TemplateModal {...defaultProps} template={template} />)
    expect(screen.getByText('Edit template')).toBeInTheDocument()
  })

  it('renders empty form in create mode', () => {
    renderWithProviders(<TemplateModal {...defaultProps} />)

    const nameInput = screen.getByPlaceholderText('Template name')
    const textInput = screen.getByPlaceholderText('Template text')

    expect(nameInput).toHaveValue('')
    expect(textInput).toHaveValue('')
  })

  it('pre-fills form in edit mode', () => {
    const template = createTemplate({ name: 'Test Template', text: 'Test content here' })
    renderWithProviders(<TemplateModal {...defaultProps} template={template} />)

    expect(screen.getByDisplayValue('Test Template')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Test content here')).toBeInTheDocument()
  })

  it('shows character count', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TemplateModal {...defaultProps} />)

    const textInput = screen.getByPlaceholderText('Template text')
    await user.type(textInput, 'Hello')

    expect(screen.getByText(/Characters: 5/)).toBeInTheDocument()
  })

  it('shows message parts as 0 for empty text', () => {
    renderWithProviders(<TemplateModal {...defaultProps} />)
    expect(screen.getByText(/Message parts: 0/)).toBeInTheDocument()
  })

  it('shows message parts as 1 for text under 160 chars', async () => {
    const user = userEvent.setup()
    renderWithProviders(<TemplateModal {...defaultProps} />)

    const textInput = screen.getByPlaceholderText('Template text')
    await user.type(textInput, 'Hello world')

    expect(screen.getByText(/Message parts: 1/)).toBeInTheDocument()
  })

  it('shows Create button in create mode', () => {
    renderWithProviders(<TemplateModal {...defaultProps} />)
    expect(screen.getByText('Create')).toBeInTheDocument()
  })

  it('shows Update button in edit mode', () => {
    const template = createTemplate()
    renderWithProviders(<TemplateModal {...defaultProps} template={template} />)
    expect(screen.getByText('Update')).toBeInTheDocument()
  })

  it('closes modal on cancel', async () => {
    const setIsOpen = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(<TemplateModal {...defaultProps} setIsOpen={setIsOpen} />)

    await user.click(screen.getByText('Cancel'))
    expect(setIsOpen).toHaveBeenCalledWith(false)
  })

  it('submits create form and closes modal', async () => {
    const setIsOpen = vi.fn()
    const setSelectedTemplateId = vi.fn()
    const user = userEvent.setup()

    renderWithProviders(
      <TemplateModal
        isOpen={true}
        setIsOpen={setIsOpen}
        setSelectedTemplateId={setSelectedTemplateId}
      />
    )

    await user.type(screen.getByPlaceholderText('Template name'), 'New Template')
    await user.type(screen.getByPlaceholderText('Template text'), 'This is template text content')
    await user.click(screen.getByText('Create'))

    await waitFor(() => {
      expect(setIsOpen).toHaveBeenCalledWith(false)
    })
  })

  it('does not render when isOpen is false', () => {
    renderWithProviders(<TemplateModal {...defaultProps} isOpen={false} />)
    expect(screen.queryByText('Create new template')).not.toBeInTheDocument()
  })
})
