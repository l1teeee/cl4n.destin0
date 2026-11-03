"use client";

import * as React from "react";
import { format, parse } from "date-fns";
import { es } from "date-fns/locale";
import { CalendarDays } from "lucide-react";

import { cn } from "@/ui/cn";
import { Calendar } from "@/ui/primitives/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";

function parseLocalDate(value: string) {
  return value ? parse(value, "yyyy-MM-dd", new Date()) : undefined;
}

function formatLocalDate(date: Date) {
  return format(date, "yyyy-MM-dd");
}

function formatDateLabel(date: Date) {
  return format(date, "d MMM yyyy", { locale: es });
}

function disabledMatchers(disabledBefore?: Date, disabledAfter?: Date) {
  const matchers: ({ before: Date } | { after: Date })[] = [];
  if (disabledBefore) matchers.push({ before: disabledBefore });
  if (disabledAfter) matchers.push({ after: disabledAfter });
  return matchers.length > 0 ? matchers : undefined;
}

interface DatePickerProps {
  id?: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
  invalid?: boolean;
  describedBy?: string;
  disabledBefore?: Date;
  disabledAfter?: Date;
}

function DatePicker({
  id,
  name,
  defaultValue = "",
  placeholder = "Selecciona una fecha",
  invalid = false,
  describedBy,
  disabledBefore,
  disabledAfter,
}: DatePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(defaultValue);
  const selected = parseLocalDate(value);
  const disabled = disabledMatchers(disabledBefore, disabledAfter);

  function selectDate(date: Date | undefined) {
    if (!date) return;
    setValue(formatLocalDate(date));
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          data-invalid={invalid || undefined}
          aria-describedby={describedBy}
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-left text-sm text-foreground transition-[border-color,background-color] duration-200 focus:border-[#b9b7b0] focus:bg-[#fffbf405] focus-visible:outline-none data-invalid:border-destructive data-invalid:focus:border-destructive [@media(hover:hover)_and_(pointer:fine)]:data-invalid:hover:border-destructive [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]"
        >
          <span className={cn(!selected && "text-muted-foreground")}>
            {selected ? formatDateLabel(selected) : placeholder}
          </span>
          <CalendarDays
            aria-hidden="true"
            className="size-4 shrink-0 stroke-[1.5] text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="p-0">
        <Calendar
          mode="single"
          selected={selected}
          defaultMonth={selected}
          disabled={disabled}
          onSelect={selectDate}
        />
      </PopoverContent>
      <input type="hidden" name={name} value={value} />
    </Popover>
  );
}

export { DatePicker, disabledMatchers, formatDateLabel, formatLocalDate, parseLocalDate };
