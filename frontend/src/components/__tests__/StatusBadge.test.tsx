import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { StatusBadge } from '../StatusBadge'
import type { ScheduleStatus } from '../../types/schedule.types'

describe('StatusBadge', () => {
  const statuses: ScheduleStatus[] = ['pending', 'processing', 'sent', 'failed', 'cancelled']

  it.each(statuses)('renders the "%s" status text', (status) => {
    render(<StatusBadge status={status} />)
    expect(screen.getByText(status)).toBeInTheDocument()
  })

  it('renders pending with indigo styling', () => {
    const { container } = render(<StatusBadge status="pending" />)
    const badge = container.querySelector('span')
    expect(badge).toBeInTheDocument()
    expect(badge?.textContent).toBe('pending')
  })

  it('renders sent with emerald styling', () => {
    const { container } = render(<StatusBadge status="sent" />)
    const badge = container.querySelector('span')
    expect(badge?.textContent).toBe('sent')
  })

  it('renders failed with orange styling', () => {
    const { container } = render(<StatusBadge status="failed" />)
    const badge = container.querySelector('span')
    expect(badge?.textContent).toBe('failed')
  })
})
