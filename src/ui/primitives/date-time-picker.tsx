"use client";

import * as React from "react";
import { format } from "date-fns";
import { CalendarDays } from "lucide-react";

import { cn } from "@/ui/cn";
import { Calendar } from "@/ui/primitives/calendar";
import { formatDateLabel, formatLocalDate, parseLocalDate } from "@/ui/primitives/date-picker";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";
import { TimeColumns } from "@/ui/primitives/time-picker";

interface DateTimePickerProps {
  id?: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  todayShortcut?: boolean;
  invalid?: boolean;
  describedBy?: string;
}

function DateTimePicker({
  id,
  name,
  defaultValue = "",
  placeholder = "Selecciona fecha y hora",
  todayShortcut = false,
  invalid = false,
  describedBy,
}: DateTimePickerProps) {
  const [dateValue, initialTime = ""] = defaultValue.split("T");
  const [date, setDate] = React.useState(dateValue || "");
  const [time, setTime] = React.useState(initialTime);
  const selected = parseLocalDate(date);
  const [month, setMonth] = React.useState<Date>(selected ?? new Date());
  const [hour = "", minute = ""] = time.split(":");
  const value = date && time ? `${date}T${time}` : "";

  function selectDate(nextDate: Date | undefined) {
    setDate(nextDate ? formatLocalDate(nextDate) : "");
  }

  function selectHour(nextHour: string) {
    setTime(`${nextHour}:${minute || "00"}`);
  }

  function selectMinute(nextMinute: string) {
    setTime(`${hour || "00"}:${nextMinute}`);
  }

  function selectToday() {
    const now = new Date();
    setDate(formatLocalDate(now));
    setMonth(now);
    if (!time) setTime(format(now, "HH:mm"));
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          data-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-left text-sm text-foreground transition-[border-color,background-color] duration-200 focus:border-[#b9b7b0] focus:bg-[#fffbf405] focus-visible:outline-none data-invalid:border-destructive data-invalid:focus:border-destructive [@media(hover:hover)_and_(pointer:fine)]:data-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? (
              <>
                {formatDateLabel(selected)} ·{" "}
                {time || <span className="text-muted-foreground">--:--</span>}
              </>
            ) : (
              placeholder
            )}
          </span>
          <CalendarDays
            aria-hidden="true"
            className="size-4 shrink-0 stroke-[1.5] text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="flex flex-col p-0 sm:flex-row">
        <div>
          <Calendar
            mode="single"
            selected={selected}
            month={month}
            onMonthChange={setMonth}
            onSelect={selectDate}
          />
          {todayShortcut ? (
            <button
              type="button"
              className="mx-3 mb-3 inline-flex h-8 items-center rounded-full px-3 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={selectToday}
            >
              Hoy
            </button>
          ) : null}
        </div>
        <div className="border-t border-input/60 p-3 sm:border-t-0 sm:border-l">
          <TimeColumns value={time} onHourChange={selectHour} onMinuteChange={selectMinute} />
        </div>
      </PopoverContent>
      <input type="hidden" name={name} value={value} />
    </Popover>
  );
}

export { DateTimePicker };
