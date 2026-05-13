import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderWithProviders, screen, userEvent, waitFor } from '../../../test/test-utils'
import { http, HttpResponse } from 'msw'
import { server } from '../../../test/handlers'
import { BuyCreditsDialog } from '../BuyCreditsDialog'

// Mock Clerk
vi.mock('@clerk/clerk-react', () => ({
  useAuth: () => ({
    getToken: vi.fn().mockResolvedValue('mock-token'),
    isSignedIn: true,
    isLoaded: true,
    userId: 'user_test123',
    orgId: 'org_test123',
  }),
}))

describe('BuyCreditsDialog', () => {
  const onClose = vi.fn()

  beforeEach(() => {
    onClose.mockClear()
  })

  it('renders preset buttons', () => {
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)
    expect(screen.getByText('$10')).toBeInTheDocument()
    expect(screen.getByText('$25')).toBeInTheDocument()
    expect(screen.getByText('$50')).toBeInTheDocument()
    expect(screen.getByText('$100')).toBeInTheDocument()
    expect(screen.getByText('$500')).toBeInTheDocument()
    expect(screen.getByText('$1,000')).toBeInTheDocument()
  })

  it('renders custom amount input', () => {
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)
    expect(screen.getByPlaceholderText('5 – 10,000')).toBeInTheDocument()
  })

  it('Purchase button is disabled with no selection', () => {
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)
    const purchaseBtn = screen.getByRole('button', { name: /Purchase/i })
    expect(purchaseBtn).toBeDisabled()
  })

  it('selecting a preset enables the Purchase button', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    await user.click(screen.getByText('$50'))

    const purchaseBtn = screen.getByRole('button', { name: /Purchase \$50/i })
    expect(purchaseBtn).not.toBeDisabled()
  })

  it('typing custom amount clears preset selection', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    await user.click(screen.getByText('$50'))
    expect(screen.getByRole('button', { name: /Purchase \$50/i })).toBeInTheDocument()

    const input = screen.getByPlaceholderText('5 – 10,000')
    await user.clear(input)
    await user.type(input, '75')

    expect(screen.getByRole('button', { name: /Purchase \$75/i })).toBeInTheDocument()
  })

  it('clicking preset clears custom amount', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText('5 – 10,000')
    await user.type(input, '75')
    await user.click(screen.getByText('$100'))

    expect(input).toHaveValue(null)
    expect(screen.getByRole('button', { name: /Purchase \$100/i })).toBeInTheDocument()
  })

  it('disables Purchase for amount below minimum', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText('5 – 10,000')
    await user.type(input, '3')

    const purchaseBtn = screen.getByRole('button', { name: /Purchase/i })
    expect(purchaseBtn).toBeDisabled()
  })

  it('disables Purchase for amount above maximum', async () => {
    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    const input = screen.getByPlaceholderText('5 – 10,000')
    await user.type(input, '20000')

    const purchaseBtn = screen.getByRole('button', { name: /Purchase/i })
    expect(purchaseBtn).toBeDisabled()
  })

  it('shows error on API failure', async () => {
    server.use(
      http.post('http://localhost:8000/api/billing/buy-credits/', () =>
        HttpResponse.json({ detail: 'Server error' }, { status: 500 })
      )
    )

    const user = userEvent.setup()
    renderWithProviders(<BuyCreditsDialog open={true} onClose={onClose} />)

    await user.click(screen.getByText('$25'))
    await user.click(screen.getByRole('button', { name: /Purchase \$25/i }))

    await waitFor(() => {
      expect(screen.getByText(/Failed to start checkout|Server error/i)).toBeInTheDocument()
    })
  })

  it('does not render when closed', () => {
    renderWithProviders(<BuyCreditsDialog open={false} onClose={onClose} />)
    expect(screen.queryByText('Buy Credits')).not.toBeInTheDocument()
  })
})
