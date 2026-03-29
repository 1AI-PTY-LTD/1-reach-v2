import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import dayjs from 'dayjs'
import { ScheduleDateTimePicker, isTimeInPast, shouldSendImmediately } from '../ScheduleDateTimePicker'

const NOW = dayjs('2026-06-15T10:00:00')

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(NOW.toDate())
  vi.stubEnv('VITE_MIN_MESSAGE_DELAY', '5')
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

function getInput() {
  return screen.getByLabelText('Scheduled Time *') as HTMLInputElement
}

describe('ScheduleDateTimePicker', () => {
  describe('rendering', () => {
    it('renders a datetime-local input with label', () => {
      render(<ScheduleDateTimePicker value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input).toBeInTheDocument()
      expect(input.type).toBe('datetime-local')
    })

    it('sets min to current time', () => {
      render(<ScheduleDateTimePicker value="" onChange={vi.fn()} />)
      const input = getInput()
      expect(input.min).toBe(NOW.format('YYYY-MM-DDTHH:mm'))
    })

    it('displays value in datetime-local format from ISO string', () => {
      const iso = '2026-06-20T14:30:00.000Z'
      render(<ScheduleDateTimePicker value={iso} onChange={vi.fn()} />)
      const input = getInput()
      // Should convert ISO to local datetime-local format
      expect(input.value).toBe(dayjs(iso).format('YYYY-MM-DDTHH:mm'))
    })

    it('shows empty when no value', () => {
      render(<ScheduleDateTimePicker value="" onChange={vi.fn()} />)
      expect(getInput().value).toBe('')
    })
  })

  describe('status indicator', () => {
    it('shows past time warning for past dates', () => {
      const pastIso = dayjs().subtract(1, 'hour').toISOString()
      render(<ScheduleDateTimePicker value={pastIso} onChange={vi.fn()} />)
      expect(screen.getByText(/can't be scheduled for a time in the past/)).toBeInTheDocument()
    })

    it('shows immediate send message for near-future times', () => {
      const nearFuture = dayjs().add(2, 'minute').toISOString()
      render(<ScheduleDateTimePicker value={nearFuture} onChange={vi.fn()} />)
      expect(screen.getByText(/will be sent immediately/)).toBeInTheDocument()
    })

    it('shows scheduled message for future times', () => {
      const future = dayjs().add(1, 'hour').toISOString()
      render(<ScheduleDateTimePicker value={future} onChange={vi.fn()} />)
      expect(screen.getByText(/will be scheduled for future delivery/)).toBeInTheDocument()
    })

    it('hides status when showStatus is false', () => {
      const future = dayjs().add(1, 'hour').toISOString()
      render(<ScheduleDateTimePicker value={future} onChange={vi.fn()} showStatus={false} />)
      expect(screen.queryByText(/will be scheduled/)).not.toBeInTheDocument()
    })

    it('shows no status when value is empty', () => {
      render(<ScheduleDateTimePicker value="" onChange={vi.fn()} />)
      expect(screen.queryByText(/scheduled/)).not.toBeInTheDocument()
      expect(screen.queryByText(/past/)).not.toBeInTheDocument()
    })
  })

  describe('onChange', () => {
    it('calls onChange with ISO string when datetime is selected', () => {
      const onChange = vi.fn()
      render(<ScheduleDateTimePicker value="" onChange={onChange} />)
      const input = getInput()
      fireEvent.change(input, { target: { value: '2026-06-20T14:30' } })
      expect(onChange).toHaveBeenCalledOnce()
      const calledWith = onChange.mock.calls[0][0]
      expect(dayjs(calledWith).isValid()).toBe(true)
      // Should be a proper ISO string
      expect(calledWith).toContain('T')
      expect(calledWith).toContain('Z')
    })

    it('calls onChange with empty string when input is cleared', () => {
      const onChange = vi.fn()
      render(<ScheduleDateTimePicker value="2026-06-20T14:30:00.000Z" onChange={onChange} />)
      fireEvent.change(getInput(), { target: { value: '' } })
      expect(onChange).toHaveBeenCalledWith('')
    })
  })
})

describe('isTimeInPast', () => {
  it('returns true for past times', () => {
    expect(isTimeInPast(dayjs().subtract(1, 'minute').toISOString())).toBe(true)
  })

  it('returns false for future times', () => {
    expect(isTimeInPast(dayjs().add(1, 'minute').toISOString())).toBe(false)
  })
})

describe('shouldSendImmediately', () => {
  it('returns true for times within MIN_MESSAGE_DELAY', () => {
    expect(shouldSendImmediately(dayjs().add(2, 'minute').toISOString())).toBe(true)
  })

  it('returns false for times beyond MIN_MESSAGE_DELAY', () => {
    expect(shouldSendImmediately(dayjs().add(10, 'minute').toISOString())).toBe(false)
  })

  it('returns true for past times', () => {
    expect(shouldSendImmediately(dayjs().subtract(1, 'minute').toISOString())).toBe(true)
  })
})
