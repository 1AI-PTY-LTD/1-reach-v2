import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { TabbedContainer, type Tab } from '../TabbedContainer'

const createTabs = (): Tab[] => [
  { id: 'tab1', label: 'Tab One', content: <div>Content One</div> },
  { id: 'tab2', label: 'Tab Two', content: <div>Content Two</div> },
  { id: 'tab3', label: 'Tab Three', content: <div>Content Three</div>, disabled: true },
]

describe('TabbedContainer', () => {
  it('renders all tab labels', () => {
    render(<TabbedContainer tabs={createTabs()} />)
    expect(screen.getByText('Tab One')).toBeInTheDocument()
    expect(screen.getByText('Tab Two')).toBeInTheDocument()
    expect(screen.getByText('Tab Three')).toBeInTheDocument()
  })

  it('shows first tab content by default', () => {
    render(<TabbedContainer tabs={createTabs()} />)
    expect(screen.getByText('Content One')).toBeInTheDocument()
  })

  it('shows content for specified default tab', () => {
    render(<TabbedContainer tabs={createTabs()} defaultActiveTab="tab2" />)
    expect(screen.getByText('Content Two')).toBeInTheDocument()
  })

  it('switches tab content on click', async () => {
    const user = userEvent.setup()
    render(<TabbedContainer tabs={createTabs()} />)

    await user.click(screen.getByText('Tab Two'))
    expect(screen.getByText('Content Two')).toBeInTheDocument()
  })

  it('calls onTabChange when tab is clicked', async () => {
    const onTabChange = vi.fn()
    const user = userEvent.setup()
    render(<TabbedContainer tabs={createTabs()} onTabChange={onTabChange} />)

    await user.click(screen.getByText('Tab Two'))
    expect(onTabChange).toHaveBeenCalledWith('tab2')
  })

  it('does not switch to disabled tab on click', async () => {
    const onTabChange = vi.fn()
    const user = userEvent.setup()
    render(<TabbedContainer tabs={createTabs()} onTabChange={onTabChange} />)

    await user.click(screen.getByText('Tab Three'))
    expect(onTabChange).not.toHaveBeenCalled()
    expect(screen.getByText('Content One')).toBeInTheDocument()
  })

  it('sets correct aria-selected attributes', () => {
    render(<TabbedContainer tabs={createTabs()} />)

    const tab1 = screen.getByText('Tab One').closest('[role="tab"]')
    const tab2 = screen.getByText('Tab Two').closest('[role="tab"]')

    expect(tab1).toHaveAttribute('aria-selected', 'true')
    expect(tab2).toHaveAttribute('aria-selected', 'false')
  })

  it('renders nothing when tabs array is empty', () => {
    const { container } = render(<TabbedContainer tabs={[]} />)
    expect(container.innerHTML).toBe('')
  })

  it('renders label when provided', () => {
    render(<TabbedContainer tabs={createTabs()} label={<span>My Label</span>} />)
    expect(screen.getByText('My Label')).toBeInTheDocument()
  })
})
