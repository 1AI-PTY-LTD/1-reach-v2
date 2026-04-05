import { describe, it, expect, vi } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import TemplateDetails from '../TemplateDetails'
import { createTemplate } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'

describe('TemplateDetails', () => {
  const defaultProps = {
    setIsOpen: vi.fn(),
    setTemplateId: vi.fn(),
  }

  it('renders template name', () => {
    const template = createTemplate({ name: 'Welcome Message' })
    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    expect(screen.getByText(/Welcome Message/)).toBeInTheDocument()
  })

  it('renders template text content', () => {
    const template = createTemplate({ text: 'Hello, welcome to our service!' })
    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    expect(screen.getByText('Hello, welcome to our service!')).toBeInTheDocument()
  })

  it('shows message parts as 1 for short text', () => {
    const template = createTemplate({ text: 'Short message' })
    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    expect(screen.getByText(/1 of 2/)).toBeInTheDocument()
  })

  it('shows message parts as 2 for long text (>160 chars)', () => {
    const template = createTemplate({ text: 'A'.repeat(161) })
    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    expect(screen.getByText(/2 of 2/)).toBeInTheDocument()
  })

  it('shows message parts as 0 for empty text', () => {
    const template = createTemplate({ text: '' })
    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    expect(screen.getByText(/0 of 2/)).toBeInTheDocument()
  })

  it('calls setTemplateId and setIsOpen on edit click', async () => {
    const setIsOpen = vi.fn()
    const setTemplateId = vi.fn()
    const user = userEvent.setup()
    const template = createTemplate({ id: 42 })

    renderWithProviders(
      <TemplateDetails template={template} setIsOpen={setIsOpen} setTemplateId={setTemplateId} />
    )

    await user.click(screen.getByText('Edit'))
    expect(setTemplateId).toHaveBeenCalledWith(42)
    expect(setIsOpen).toHaveBeenCalledWith(true)
  })

  it('shows delete confirmation dialog on delete click', async () => {
    const user = userEvent.setup()
    const template = createTemplate()

    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    await user.click(screen.getByText('Delete'))

    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this template?')).toBeInTheDocument()
    })
  })

  it('closes delete dialog on cancel', async () => {
    const user = userEvent.setup()
    const template = createTemplate()

    renderWithProviders(<TemplateDetails template={template} {...defaultProps} />)

    await user.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this template?')).toBeInTheDocument()
    })

    await user.click(screen.getByText('Cancel'))
    await waitFor(() => {
      expect(screen.queryByText('Are you sure you want to delete this template?')).not.toBeInTheDocument()
    })
  })
})
