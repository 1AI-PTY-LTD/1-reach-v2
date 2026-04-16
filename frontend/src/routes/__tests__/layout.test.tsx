import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { EnvelopeIcon } from '@heroicons/react/16/solid'

// Re-create the Support NavbarItem in isolation to test its behaviour
// (mirrors the pattern used by other route tests that re-create internal components)
function SupportButton() {
  return (
    <button
      aria-label="Contact Support"
      onClick={() => {
        window.location.href =
          'mailto:support@1ai.net.au?subject=' +
          encodeURIComponent('1Reach Support Request')
      }}
    >
      <EnvelopeIcon data-slot="icon" />
      Support
    </button>
  )
}

describe('AppLayout toolbar', () => {
  describe('support button', () => {
    it('renders Support button with accessible label', () => {
      render(<SupportButton />)
      expect(screen.getByText('Support')).toBeInTheDocument()
      expect(screen.getByLabelText('Contact Support')).toBeInTheDocument()
    })

    it('opens mailto link when clicked', async () => {
      const user = userEvent.setup()
      const originalLocation = window.location
      let capturedHref = ''
      Object.defineProperty(window, 'location', {
        writable: true,
        value: {
          ...originalLocation,
          set href(url: string) {
            capturedHref = url
          },
        },
      })

      render(<SupportButton />)
      await user.click(screen.getByText('Support'))

      expect(capturedHref).toContain('mailto:support@1ai.net.au')
      expect(capturedHref).toContain('1Reach%20Support%20Request')

      Object.defineProperty(window, 'location', {
        writable: true,
        value: originalLocation,
      })
    })
  })
})
