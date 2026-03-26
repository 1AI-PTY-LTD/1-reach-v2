import { Field, Label } from "../ui/fieldset";
import { Select } from "../ui/select";
import { useState, useEffect } from "react";
import dayjs from "dayjs";
import Logger from "../utils/logger";

interface DateFieldApi {
    state: { value: string };
    handleChange: (value: string) => void;
}

export function DateSelect({
    field,
}: {
    field: DateFieldApi;
}) {
    Logger.debug("Rendering DateSelect", { 
        component: "DateSelect",
        data: { currentValue: field.state.value }
    });

    const currentDay = dayjs().date();
    const currentMonth = dayjs().month();
    const currentYear = dayjs().year();

    const initialDate = field.state.value ? dayjs(field.state.value) : null;
    const initialDay = initialDate?.isValid() ? initialDate.date() : null;
    const initialMonth = initialDate?.isValid() ? initialDate.month() : null;
    const initialYear = initialDate?.isValid() ? initialDate.year() : null;

    const [day, setDay] = useState(initialDay ?? currentDay);
    const [month, setMonth] = useState(initialMonth ?? currentMonth);
    const [year, setYear] = useState(initialYear ?? currentYear);
    const [time, setTime] = useState(initialDate?.format("HH:mm") || "12:00");
    const [pastDateWarning, setPastDateWarning] = useState(false);

    useEffect(() => {
        const selectedDate = dayjs()
            .year(year)
            .month(month)
            .date(day)
            .hour(parseInt(time.split(":")[0]))
            .minute(parseInt(time.split(":")[1]));
        const currentDate = dayjs().startOf("day");
        const formattedSelectedDate = selectedDate.toISOString();

        Logger.debug("Date selection changed", {
            component: "DateSelect",
            data: { 
                selectedDate: formattedSelectedDate,
                isPastDate: selectedDate.isBefore(currentDate)
            }
        });

        if (formattedSelectedDate !== field.state.value) {
            if (selectedDate.isBefore(currentDate)) {
                Logger.warn("Past date selected, resetting to current date", {
                    component: "DateSelect",
                    data: {
                        selectedDate: formattedSelectedDate,
                        currentDate: currentDate.toISOString()
                    }
                });
                setPastDateWarning(true);
                setTimeout(() => setPastDateWarning(false), 3000);
                setYear(currentYear);
                setMonth(currentMonth);
                setDay(currentDay);
                return;
            }

            field.handleChange(formattedSelectedDate);
        }
    }, [day, month, year, time, field]);

    const handleDayChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newDay = Number(e.target.value);
        Logger.debug("Day changed", {
            component: "DateSelect",
            data: { newDay, currentDay }
        });
        setDay(newDay);
    };

    const handleMonthChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newMonth = Number(e.target.value);
        Logger.debug("Month changed", {
            component: "DateSelect",
            data: { 
                newMonth,
                monthName: dayjs().month(newMonth).format("MMMM")
            }
        });
        setMonth(newMonth);
    };

    const handleYearChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
        const newYear = Number(e.target.value);
        Logger.debug("Year changed", {
            component: "DateSelect",
            data: { newYear, currentYear }
        });
        setYear(newYear);
    };

    const handleTimeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        Logger.debug("Time changed", {
            component: "DateSelect",
            data: { newTime: e.target.value }
        });
        setTime(e.target.value);
    };

    const dayOptions = Array.from(
        { length: dayjs().month(month).daysInMonth() },
        (_, i) => (
            <option
                key={i + 1}
                value={i + 1}
                disabled={
                    year === currentYear &&
                    month === currentMonth &&
                    i + 1 < currentDay
                }
            >
                {i + 1}
            </option>
        )
    );

    const monthOptions = Array.from({ length: 12 }, (_, i) => (
        <option
            key={i + 1}
            value={i}
            disabled={year === currentYear && i < currentMonth}
        >
            {dayjs().month(i).format("MMMM")}
        </option>
    ));

    const yearOptions = Array.from({ length: 5 }, (_, i) => {
        const yearValue = currentYear + i;
        return (
            <option
                key={yearValue}
                value={yearValue}
            >
                {yearValue}
            </option>
        );
    });

    return (
        <Field className="mt-4">
            {pastDateWarning && (
                <p className="text-sm text-red-500 mb-2">Scheduled time must be in the future</p>
            )}
            <div className="flex gap-4 justify-start">
            <div className="w-18">
                <Label className="ms-2 mb-2">Day</Label>
                <Select
                    name="day"
                    value={day}
                    onChange={handleDayChange}
                >
                    {dayOptions}
                </Select>
            </div>
            <div className="w-18">
                <Label className="ms-2 mb-2">Month</Label>
                <Select
                    name="month"
                    value={month}
                    onChange={handleMonthChange}
                >
                    {monthOptions}
                </Select>
            </div>
            <div className="w-18">
                <Label className="ms-2 mb-2">Year</Label>
                <Select
                    name="year"
                    value={year}
                    onChange={handleYearChange}
                >
                    {yearOptions}
                </Select>
            </div>
            <div>
                <Label className="ms-2 mb-2">Time</Label>
                <input
                    value={time}
                    onChange={handleTimeChange}
                    className="block rounded-md py-1 px-1 mt-[1px] dark:bg-white/5 dark:text-white dark:border dark:border-white/10"
                    type="time"
                />
            </div>
            </div>
        </Field>
    );
}
