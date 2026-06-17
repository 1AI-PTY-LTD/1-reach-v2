import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Suspense } from 'react'
import { renderWithProviders, screen, waitFor } from '../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../test/handlers'
import { createTemplate } from '../../test/factories'

// The real TemplateDetails reads its route param via `Route.useParams()` (where
// `Route` is the object createFileRoute returns), so expose useParams on it.
// `mockParams.current` lets a test switch which templateId resolves.
const { mockParams } = vi.hoisted(() => ({
  mockParams: { current: { templateId: 7 } },
}))

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (options: Record<string, unknown>) => ({
    ...options,
    useParams: () => mockParams.current,
  }),
  useParams: () => mockParams.current,
}))

// Import the REAL exported component after the router mock is set up.
import { TemplateDetails } from '../app/_layout.templates.$templateId'

const BASE_URL = 'http://localhost:8000'

describe('TemplateDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockParams.current = { templateId: 7 }
  })

  it('fetches the template by its route param and renders its name and text', async () => {
    server.use(
      http.get(`${BASE_URL}/api/templates/:id/`, ({ params }) => {
        expect(params.id).toBe('7')
        return HttpResponse.json(
          createTemplate({ id: 7, name: 'Welcome message', text: 'Hi there, welcome aboard!' }),
        )
      }),
    )

    renderWithProviders(
      <Suspense fallback={<div>loading</div>}>
        <TemplateDetails />
      </Suspense>,
    )

    await waitFor(() => {
      expect(screen.getByText(/Welcome message/)).toBeInTheDocument()
    })
    expect(screen.getByText('Hi there, welcome aboard!')).toBeInTheDocument()
    // The Edit affordance is rendered.
    expect(screen.getByRole('button', { name: /Edit/ })).toBeInTheDocument()
  })

  it('requests the template id taken from the route param', async () => {
    mockParams.current = { templateId: 42 }
    let requestedId: string | undefined
    server.use(
      http.get(`${BASE_URL}/api/templates/:id/`, ({ params }) => {
        requestedId = params.id as string
        return HttpResponse.json(createTemplate({ id: 42, name: 'Reminder', text: 'Your appointment is soon.' }))
      }),
    )

    renderWithProviders(
      <Suspense fallback={<div>loading</div>}>
        <TemplateDetails />
      </Suspense>,
    )

    await waitFor(() => expect(screen.getByText(/Reminder/)).toBeInTheDocument())
    expect(requestedId).toBe('42')
  })
})
