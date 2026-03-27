import { Popover, PopoverButton, PopoverPanel } from '@headlessui/react'
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/16/solid'
import dayjs from 'dayjs'
import { useState } from 'react'

interface DatePickerProps {
  value: dayjs.Dayjs
  onChange: (date: dayjs.Dayjs) => void
}

const DAYS_OF_WEEK = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function getCalendarDays(viewDate: dayjs.Dayjs) {
  const startOfMonth = viewDate.startOf('month')
  const endOfMonth = viewDate.endOf('month')

  // dayjs .day() is 0=Sun, 1=Mon, ... 6=Sat
  // We want Monday-first, so shift: (day + 6) % 7 gives 0=Mon, 6=Sun
  const startDay = (startOfMonth.day() + 6) % 7
  const daysInMonth = endOfMonth.date()

  const days: (dayjs.Dayjs | null)[] = []

  // Leading blanks
  for (let i = 0; i < startDay; i++) {
    days.push(null)
  }

  // Month days
  for (let d = 1; d <= daysInMonth; d++) {
    days.push(viewDate.date(d))
  }

  return days
}

export default function DatePicker({ value, onChange }: DatePickerProps) {
  const [viewDate, setViewDate] = useState(value)

  const today = dayjs().startOf('day')
  const days = getCalendarDays(viewDate)

  return (
    <Popover className="relative">
      {({ close }) => (
        <>
          <PopoverButton
            className="text-2xl/8 font-semibold text-zinc-950 sm:text-xl/8 dark:text-white hover:text-brand-teal dark:hover:text-brand-teal cursor-pointer focus:outline-none"
            onClick={() => setViewDate(value)}
          >
            {value.format('DD/MM/YYYY')}
          </PopoverButton>

          <PopoverPanel
            anchor="bottom"
            className="z-50 mt-2 w-72 rounded-lg border border-zinc-200 bg-white p-3 shadow-lg dark:border-white/10 dark:bg-zinc-800"
          >
            {/* Month/Year header */}
            <div className="mb-2 flex items-center justify-between">
              <button
                type="button"
                onClick={() => setViewDate(viewDate.subtract(1, 'month'))}
                className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <ChevronLeftIcon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
              </button>
              <span className="text-sm font-semibold text-zinc-900 dark:text-white">
                {viewDate.format('MMMM YYYY')}
              </span>
              <button
                type="button"
                onClick={() => setViewDate(viewDate.add(1, 'month'))}
                className="rounded p-1 hover:bg-zinc-100 dark:hover:bg-zinc-700"
              >
                <ChevronRightIcon className="h-4 w-4 text-zinc-600 dark:text-zinc-300" />
              </button>
            </div>

            {/* Day-of-week headers */}
            <div className="grid grid-cols-7 text-center text-xs font-medium text-zinc-500 dark:text-zinc-400">
              {DAYS_OF_WEEK.map((d) => (
                <div key={d} className="py-1">
                  {d}
                </div>
              ))}
            </div>

            {/* Calendar grid */}
            <div className="grid grid-cols-7 text-center text-sm">
              {days.map((day, i) => {
                if (!day) {
                  return <div key={`blank-${i}`} />
                }

                const isToday = day.isSame(today, 'day')
                const isSelected = day.isSame(value, 'day')

                return (
                  <button
                    key={day.date()}
                    type="button"
                    onClick={() => {
                      onChange(day)
                      close()
                    }}
                    className={`m-0.5 rounded-md py-1.5 transition-colors ${
                      isSelected
                        ? 'bg-brand-teal text-white font-semibold'
                        : isToday
                          ? 'bg-zinc-100 font-semibold text-zinc-900 dark:bg-zinc-700 dark:text-white'
                          : 'text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-700'
                    }`}
                  >
                    {day.date()}
                  </button>
                )
              })}
            </div>

            {/* Today shortcut */}
            <button
              type="button"
              onClick={() => {
                onChange(dayjs())
                close()
              }}
              className="mt-2 w-full rounded-md py-1.5 text-center text-xs font-medium text-brand-teal hover:bg-zinc-100 dark:hover:bg-zinc-700"
            >
              Today
            </button>
          </PopoverPanel>
        </>
      )}
    </Popover>
  )
}
