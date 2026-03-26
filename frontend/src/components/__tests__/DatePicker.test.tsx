import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import dayjs from 'dayjs'
import DatePicker from '../DatePicker'

const TODAY = dayjs('2026-06-15') // Monday

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY.toDate())
})

afterEach(() => {
  vi.useRealTimers()
})

function renderPicker(value = TODAY, onChange = vi.fn()) {
  const result = render(<DatePicker value={value} onChange={onChange} />)
  return { ...result, onChange }
}

async function openPicker() {
  const trigger = screen.getByText(TODAY.format('DD/MM/YYYY'))
  await act(async () => {
    fireEvent.click(trigger)
  })
}

describe('DatePicker', () => {
  describe('trigger button', () => {
    it('displays the formatted date', () => {
      renderPicker()
      expect(screen.getByText('15/06/2026')).toBeInTheDocument()
    })

    it('displays a different date when value changes', () => {
      renderPicker(dayjs('2026-12-25'))
      expect(screen.getByText('25/12/2026')).toBeInTheDocument()
    })
  })

  describe('calendar panel', () => {
    it('shows day-of-week headers when opened', async () => {
      renderPicker()
      await openPicker()

      for (const day of ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']) {
        expect(screen.getByText(day)).toBeInTheDocument()
      }
    })

    it('shows the current month and year in the header', async () => {
      renderPicker()
      await openPicker()

      expect(screen.getByText('June 2026')).toBeInTheDocument()
    })

    it('renders day buttons for every day of the month', async () => {
      renderPicker()
      await openPicker()

      // June has 30 days
      const dayButtons = screen.getAllByRole('button').filter((btn) => {
        const text = btn.textContent
        return text && /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 30
      })
      expect(dayButtons).toHaveLength(30)
    })

    it('shows a Today shortcut button', async () => {
      renderPicker()
      await openPicker()

      expect(screen.getByText('Today')).toBeInTheDocument()
    })
  })

  describe('month navigation', () => {
    it('navigates to the previous month', async () => {
      renderPicker()
      await openPicker()

      expect(screen.getByText('June 2026')).toBeInTheDocument()

      // Click the first chevron button (previous month)
      const navButtons = screen.getAllByRole('button').filter(
        (btn) => btn.querySelector('svg') && btn.textContent === '',
      )
      await act(async () => {
        fireEvent.click(navButtons[0])
      })

      expect(screen.getByText('May 2026')).toBeInTheDocument()
    })

    it('navigates to the next month', async () => {
      renderPicker()
      await openPicker()

      const navButtons = screen.getAllByRole('button').filter(
        (btn) => btn.querySelector('svg') && btn.textContent === '',
      )
      await act(async () => {
        fireEvent.click(navButtons[1])
      })

      expect(screen.getByText('July 2026')).toBeInTheDocument()
    })

    it('can navigate across year boundaries', async () => {
      renderPicker(dayjs('2026-01-10'))
      const trigger = screen.getByText('10/01/2026')
      await act(async () => {
        fireEvent.click(trigger)
      })

      expect(screen.getByText('January 2026')).toBeInTheDocument()

      // Click previous month to go to December 2025
      const navButtons = screen.getAllByRole('button').filter(
        (btn) => btn.querySelector('svg') && btn.textContent === '',
      )
      await act(async () => {
        fireEvent.click(navButtons[0])
      })

      expect(screen.getByText('December 2025')).toBeInTheDocument()
    })
  })

  describe('day selection', () => {
    it('calls onChange with the selected day', async () => {
      const onChange = vi.fn()
      renderPicker(TODAY, onChange)
      await openPicker()

      // Click day 20
      const day20 = screen.getAllByRole('button').find((btn) => btn.textContent === '20')!
      await act(async () => {
        fireEvent.click(day20)
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      const selected = onChange.mock.calls[0][0] as dayjs.Dayjs
      expect(selected.date()).toBe(20)
      expect(selected.month()).toBe(5) // June = 5 (0-indexed)
      expect(selected.year()).toBe(2026)
    })

    it('calls onChange with day 1', async () => {
      const onChange = vi.fn()
      renderPicker(TODAY, onChange)
      await openPicker()

      const day1 = screen.getAllByRole('button').find((btn) => btn.textContent === '1')!
      await act(async () => {
        fireEvent.click(day1)
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      expect((onChange.mock.calls[0][0] as dayjs.Dayjs).date()).toBe(1)
    })

    it('calls onChange with a day from a navigated month', async () => {
      const onChange = vi.fn()
      renderPicker(TODAY, onChange)
      await openPicker()

      // Navigate to July
      const navButtons = screen.getAllByRole('button').filter(
        (btn) => btn.querySelector('svg') && btn.textContent === '',
      )
      await act(async () => {
        fireEvent.click(navButtons[1])
      })

      expect(screen.getByText('July 2026')).toBeInTheDocument()

      // Click day 4
      const day4 = screen.getAllByRole('button').find((btn) => btn.textContent === '4')!
      await act(async () => {
        fireEvent.click(day4)
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      const selected = onChange.mock.calls[0][0] as dayjs.Dayjs
      expect(selected.date()).toBe(4)
      expect(selected.month()).toBe(6) // July = 6
    })
  })

  describe('today shortcut', () => {
    it('calls onChange with today when Today button is clicked', async () => {
      const onChange = vi.fn()
      // Start on a different date
      renderPicker(dayjs('2026-08-10'), onChange)

      const trigger = screen.getByText('10/08/2026')
      await act(async () => {
        fireEvent.click(trigger)
      })

      const todayBtn = screen.getByText('Today')
      await act(async () => {
        fireEvent.click(todayBtn)
      })

      expect(onChange).toHaveBeenCalledTimes(1)
      const selected = onChange.mock.calls[0][0] as dayjs.Dayjs
      expect(selected.date()).toBe(15)
      expect(selected.month()).toBe(5) // June
      expect(selected.year()).toBe(2026)
    })
  })

  describe('calendar grid correctness', () => {
    it('starts June 2026 on Monday (no leading blanks)', async () => {
      // June 1, 2026 is a Monday
      renderPicker()
      await openPicker()

      // The first button in the calendar grid should be "1" (no blanks before it)
      const dayButtons = screen.getAllByRole('button').filter((btn) => {
        const text = btn.textContent
        return text && /^\d+$/.test(text)
      })
      expect(dayButtons[0].textContent).toBe('1')
    })

    it('renders correct number of days for February in a non-leap year', async () => {
      renderPicker(dayjs('2027-02-10'))

      const trigger = screen.getByText('10/02/2027')
      await act(async () => {
        fireEvent.click(trigger)
      })

      expect(screen.getByText('February 2027')).toBeInTheDocument()

      // Feb 2027 has 28 days
      const dayButtons = screen.getAllByRole('button').filter((btn) => {
        const text = btn.textContent
        return text && /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 31
      })
      expect(dayButtons).toHaveLength(28)
    })

    it('renders 29 days for February in a leap year', async () => {
      renderPicker(dayjs('2028-02-10'))

      const trigger = screen.getByText('10/02/2028')
      await act(async () => {
        fireEvent.click(trigger)
      })

      expect(screen.getByText('February 2028')).toBeInTheDocument()

      const dayButtons = screen.getAllByRole('button').filter((btn) => {
        const text = btn.textContent
        return text && /^\d+$/.test(text) && Number(text) >= 1 && Number(text) <= 31
      })
      expect(dayButtons).toHaveLength(29)
    })
  })

  describe('styling', () => {
    it('highlights the selected date', async () => {
      renderPicker()
      await openPicker()

      const day15 = screen.getAllByRole('button').find((btn) => btn.textContent === '15')!
      expect(day15.className).toContain('bg-brand-teal')
      expect(day15.className).toContain('text-white')
    })

    it('highlights today differently when it is not selected', async () => {
      // Value is day 10, but today is June 15
      renderPicker(dayjs('2026-06-10'))

      const trigger = screen.getByText('10/06/2026')
      await act(async () => {
        fireEvent.click(trigger)
      })

      const day15 = screen.getAllByRole('button').find((btn) => btn.textContent === '15')!
      expect(day15.className).toContain('bg-zinc-100')
      expect(day15.className).not.toContain('bg-brand-teal')
    })

    it('does not highlight a regular day', async () => {
      renderPicker()
      await openPicker()

      const day20 = screen.getAllByRole('button').find((btn) => btn.textContent === '20')!
      expect(day20.className).not.toContain('bg-brand-teal')
      // Should not have bg-zinc-100 as a standalone class (hover: prefix is fine)
      expect(day20.className).not.toMatch(/(?<!\S)bg-zinc-100(?!\S)/)
    })
  })
})
