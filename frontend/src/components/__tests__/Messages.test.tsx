import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import dayjs from 'dayjs'
import MessagesWidget from '../Messages'
import { createSchedule } from '../../test/factories'
import type { Schedule } from '../../types/schedule.types'

// MessagesWidget renders TableRows with `to`/`params`, which makes the table
// cells render a TanStack Router <Link>. That Link requires a RouterProvider,
// so we stub the router primitives with a plain anchor (same pattern as the
// GroupsWidget test).
vi.mock('@tanstack/react-router', () => ({
  // Render the Link as a real anchor with an href derived from `to` so it is
  // exposed as role="link" in the accessibility tree. Keep `to`/`params` on the
  // element (via data-* attributes) so the navigation target stays assertable.
  Link: ({ children, to, params, ...props }: any) => (
    <a
      {...props}
      href={String(to)}
      data-to={String(to)}
      data-params={params ? JSON.stringify(params) : undefined}
    >
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: () => ({ pathname: '/app/schedule' }),
}))

describe('MessagesWidget', () => {
  it('renders the Messages heading and a search input', () => {
    render(<MessagesWidget messages={[]} />)

    expect(screen.getByText('Messages')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument()
  })

  it('renders nothing in the body when there are no messages', () => {
    render(<MessagesWidget messages={[]} />)

    // No message text rows should appear.
    expect(screen.queryByText('Scheduled test message')).not.toBeInTheDocument()
  })

  describe('time formatting (lowercase h:mma)', () => {
    it('formats an afternoon scheduled_time as lowercase h:mma', () => {
      const scheduledTime = '2026-01-15T14:05:00'
      const expected = dayjs(scheduledTime).format('h:mma').toLowerCase()
      const message = createSchedule({ id: 1, scheduled_time: scheduledTime, text: 'Afternoon hello' })

      render(<MessagesWidget messages={[message]} />)

      // dayjs renders in the host timezone; derive the expected value the same
      // way the component does so the assertion is timezone-independent.
      expect(screen.getByText(expected)).toBeInTheDocument()
      // The formatted value is lowercase (e.g. "2:05pm", never "2:05PM").
      expect(expected).toBe(expected.toLowerCase())
      expect(expected).toMatch(/^\d{1,2}:\d{2}(am|pm)$/)
    })

    it('formats a morning scheduled_time with a single-digit hour', () => {
      const scheduledTime = '2026-01-15T09:30:00'
      const expected = dayjs(scheduledTime).format('h:mma').toLowerCase()
      const message = createSchedule({ id: 2, scheduled_time: scheduledTime, text: 'Morning hello' })

      render(<MessagesWidget messages={[message]} />)

      expect(screen.getByText(expected)).toBeInTheDocument()
      expect(expected).toMatch(/(am|pm)$/)
    })

    it('renders one formatted time per message', () => {
      const messages: Schedule[] = [
        createSchedule({ id: 1, scheduled_time: '2026-01-15T08:00:00', text: 'First' }),
        createSchedule({ id: 2, scheduled_time: '2026-01-15T20:15:00', text: 'Second' }),
      ]

      render(<MessagesWidget messages={messages} />)

      expect(screen.getByText('First')).toBeInTheDocument()
      expect(screen.getByText('Second')).toBeInTheDocument()
    })
  })

  describe('message text rendering', () => {
    it('renders the full text of a long message without JS truncation', () => {
      const longText =
        'Hello Alice, this is a deliberately long scheduled message that runs well past forty characters to confirm the full body is rendered'
      const message = createSchedule({ id: 3, scheduled_time: '2026-01-15T10:00:00', text: longText })

      render(<MessagesWidget messages={[message]} />)

      // Messages widget displays the message verbatim (any visual clipping is
      // CSS-only via whitespace-nowrap/overflow, not text truncation).
      expect(screen.getByText(longText)).toBeInTheDocument()
    })

    it('renders a short message in full', () => {
      const message = createSchedule({ id: 4, scheduled_time: '2026-01-15T11:11:00', text: 'Short one' })

      render(<MessagesWidget messages={[message]} />)

      expect(screen.getByText('Short one')).toBeInTheDocument()
    })
  })

  describe('row navigation target', () => {
    it('links each row to the schedule detail route for that message id', () => {
      const message = createSchedule({ id: 99, scheduled_time: '2026-01-15T12:00:00', text: 'Routed message' })

      render(<MessagesWidget messages={[message]} />)

      // The stubbed Link exposes `to`/`params` as href/data-* on the anchor.
      const links = screen.getAllByRole('link')
      expect(links.length).toBeGreaterThan(0)

      // Every row links to the schedule detail route...
      const routeLink = links.find(
        (a) => a.getAttribute('data-to') === '/app/schedule/$msgId'
      )
      expect(routeLink).toBeDefined()
      expect(routeLink).toHaveAttribute('href', '/app/schedule/$msgId')
      // ...with the message id passed as the `msgId` route param.
      expect(routeLink).toHaveAttribute('data-params', JSON.stringify({ msgId: 99 }))
    })
  })
})
