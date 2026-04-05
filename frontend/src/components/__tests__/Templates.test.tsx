import { describe, it, expect } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import TemplatesWidget from '../Templates'
import { createTemplate, paginate } from '../../test/factories'
import { renderWithProviders } from '../../test/test-utils'
import { server } from '../../test/handlers'

const BASE_URL = 'http://localhost:8000'

describe('TemplatesWidget', () => {
  it('renders template list', async () => {
    renderWithProviders(<TemplatesWidget />)

    await waitFor(() => {
      expect(screen.getByText('Welcome')).toBeInTheDocument()
      expect(screen.getByText('Reminder')).toBeInTheDocument()
    })
  })

  it('selects first template by default and shows details', async () => {
    renderWithProviders(<TemplatesWidget />)

    await waitFor(() => {
      expect(screen.getByText('Welcome')).toBeInTheDocument()
    })

    // First template's details should be shown
    expect(screen.getByText(/Template Name: Welcome/)).toBeInTheDocument()
  })

  it('shows empty state when no templates exist', async () => {
    server.use(
      http.get(`${BASE_URL}/api/templates/`, () => {
        return HttpResponse.json(paginate([]))
      })
    )

    renderWithProviders(<TemplatesWidget />)

    await waitFor(() => {
      expect(screen.getByText('No templates yet')).toBeInTheDocument()
    })
  })

  it('does not crash when the selected template is deleted and list becomes empty', async () => {
    const singleTemplate = createTemplate({ id: 99, name: 'Only Template', text: 'Some text' })

    server.use(
      http.get(`${BASE_URL}/api/templates/`, () => {
        return HttpResponse.json(paginate([singleTemplate]))
      }),
      http.put(`${BASE_URL}/api/templates/:id/`, () => {
        return HttpResponse.json({ ...singleTemplate, is_active: false })
      })
    )

    const user = userEvent.setup()
    renderWithProviders(<TemplatesWidget />)

    // Wait for the template to render
    await waitFor(() => {
      expect(screen.getByText('Only Template')).toBeInTheDocument()
    })

    // Override the GET to return empty list (simulating post-deletion refetch)
    server.use(
      http.get(`${BASE_URL}/api/templates/`, () => {
        return HttpResponse.json(paginate([]))
      })
    )

    // Click Delete button and confirm
    await user.click(screen.getByText('Delete'))
    await waitFor(() => {
      expect(screen.getByText('Are you sure you want to delete this template?')).toBeInTheDocument()
    })

    await user.click(screen.getAllByText('Delete').find(
      (el) => el.closest('[role="alertdialog"], [role="dialog"]')
    )!)

    // Should show empty state without crashing
    await waitFor(() => {
      expect(screen.getByText('No templates yet')).toBeInTheDocument()
    })
  })
})
