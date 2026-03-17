import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent, act } from '@testing-library/react'
import dayjs from 'dayjs'
import { DateSelect } from '../DateSelect'

function makeField(value: string | null = null) {
  return {
    state: { value },
    handleChange: vi.fn(),
  } as any
}

const TODAY = dayjs('2026-06-15')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(TODAY.toDate())
})

afterEach(() => {
  vi.useRealTimers()
})

function getDaySelect(container: HTMLElement) {
  return container.querySelector('[name="day"]') as HTMLSelectElement
}
function getMonthSelect(container: HTMLElement) {
  return container.querySelector('[name="month"]') as HTMLSelectElement
}
function getYearSelect(container: HTMLElement) {
  return container.querySelector('[name="year"]') as HTMLSelectElement
}

describe('DateSelect', () => {
  describe('rendering', () => {
    it('renders Day, Month, Year, and Time labels', () => {
      render(<DateSelect field={makeField()} />)
      expect(screen.getByText('Day')).toBeInTheDocument()
      expect(screen.getByText('Month')).toBeInTheDocument()
      expect(screen.getByText('Year')).toBeInTheDocument()
      expect(screen.getByText('Time')).toBeInTheDocument()
    })

    it('renders day, month, and year selects', () => {
      const { container } = render(<DateSelect field={makeField()} />)
      expect(getDaySelect(container)).toBeInTheDocument()
      expect(getMonthSelect(container)).toBeInTheDocument()
      expect(getYearSelect(container)).toBeInTheDocument()
    })

    it('renders a time input', () => {
      render(<DateSelect field={makeField()} />)
      expect(screen.getByDisplayValue('12:00')).toBeInTheDocument()
    })

    it('initializes with current date when no field value provided', () => {
      const { container } = render(<DateSelect field={makeField()} />)
      expect(Number(getDaySelect(container).value)).toBe(TODAY.date())
      expect(Number(getYearSelect(container).value)).toBe(TODAY.year())
    })

    it('initializes selects from a provided ISO date value', () => {
      const futureDate = '2027-03-20T10:30:00.000Z'
      const { container } = render(<DateSelect field={makeField(futureDate)} />)
      expect(Number(getYearSelect(container).value)).toBe(2027)
    })

    it('initializes time from a provided ISO date value', () => {
      const futureDate = '2027-03-20T10:30:00.000Z'
      render(<DateSelect field={makeField(futureDate)} />)
      expect(screen.getByDisplayValue('10:30')).toBeInTheDocument()
    })
  })

  describe('future date selection', () => {
    it('calls handleChange when a future year is selected', async () => {
      const field = makeField()
      const { container } = render(<DateSelect field={field} />)
      field.handleChange.mockClear()

      const yearSelect = getYearSelect(container)
      await act(async () => {
        fireEvent.change(yearSelect, { target: { value: '2027' } })
      })

      expect(field.handleChange).toHaveBeenCalled()
      const calledWith = field.handleChange.mock.calls[0][0]
      expect(dayjs(calledWith).year()).toBe(2027)
    })

    it('passes a valid ISO string to handleChange', async () => {
      const field = makeField()
      const { container } = render(<DateSelect field={field} />)

      const yearSelect = getYearSelect(container)
      await act(async () => {
        fireEvent.change(yearSelect, { target: { value: '2028' } })
      })

      const calledWith = field.handleChange.mock.calls[0][0]
      expect(dayjs(calledWith).isValid()).toBe(true)
    })
  })

  describe('past date rejection', () => {
    it('does not call handleChange with a past date', async () => {
      const field = makeField()
      const { container } = render(<DateSelect field={field} />)
      field.handleChange.mockClear()

      const yearSelect = getYearSelect(container)
      await act(async () => {
        fireEvent.change(yearSelect, { target: { value: '2025' } })
      })

      // No call should have been made with a past date
      for (const [arg] of field.handleChange.mock.calls) {
        expect(dayjs(arg).isBefore(dayjs().startOf('day'))).toBe(false)
      }
    })

    it('resets year select back to current year when past year is selected', async () => {
      const field = makeField()
      const { container } = render(<DateSelect field={field} />)

      const yearSelect = getYearSelect(container)
      await act(async () => {
        fireEvent.change(yearSelect, { target: { value: '2025' } })
      })

      expect(Number(yearSelect.value)).toBe(TODAY.year())
    })
  })

  describe('year options', () => {
    it('renders 5 years starting from current year', () => {
      const { container } = render(<DateSelect field={makeField()} />)
      const yearSelect = getYearSelect(container)
      const options = yearSelect.querySelectorAll('option')
      expect(options).toHaveLength(5)
      expect(Number(options[0].value)).toBe(TODAY.year())
      expect(Number(options[4].value)).toBe(TODAY.year() + 4)
    })
  })

  describe('month options', () => {
    it('renders 12 months', () => {
      const { container } = render(<DateSelect field={makeField()} />)
      const monthSelect = getMonthSelect(container)
      expect(monthSelect.querySelectorAll('option')).toHaveLength(12)
    })

    it('disables past months in the current year', () => {
      const { container } = render(<DateSelect field={makeField()} />)
      const monthSelect = getMonthSelect(container)
      const options = Array.from(monthSelect.querySelectorAll('option'))

      const currentMonthIndex = TODAY.month() // 0-based
      for (let i = 0; i < currentMonthIndex; i++) {
        expect(options[i].disabled).toBe(true)
      }
      expect(options[currentMonthIndex].disabled).toBe(false)
    })
  })

  describe('time input', () => {
    it('updates time and calls handleChange with correct hour and minute', async () => {
      const field = makeField()
      render(<DateSelect field={field} />)
      field.handleChange.mockClear()

      const timeInput = screen.getByDisplayValue('12:00')
      await act(async () => {
        fireEvent.change(timeInput, { target: { value: '09:30' } })
      })

      expect(field.handleChange).toHaveBeenCalled()
      const calledWith = field.handleChange.mock.calls[0][0]
      const parsed = dayjs(calledWith)
      expect(parsed.hour()).toBe(9)
      expect(parsed.minute()).toBe(30)
    })
  })
})
