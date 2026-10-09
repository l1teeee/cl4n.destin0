"use client";

import * as React from "react";
import { Clock } from "lucide-react";

import { cn } from "@/ui/cn";
import { Popover, PopoverContent, PopoverTrigger } from "@/ui/primitives/popover";

const hours = Array.from({ length: 24 }, (_, index) => String(index).padStart(2, "0"));
const minutes = Array.from({ length: 60 }, (_, index) => String(index).padStart(2, "0"));

interface TimeColumnsProps {
  value: string;
  onHourChange: (hour: string) => void;
  onMinuteChange: (minute: string) => void;
}

function TimeColumn({
  label,
  options,
  selected,
  onSelect,
}: {
  label: string;
  options: string[];
  selected: string;
  onSelect: (value: string) => void;
}) {
  const listRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    const list = listRef.current;
    const item = list?.querySelector<HTMLElement>("[data-selected=true]");
    if (!list || !item) return;

    // scrollIntoView would also scroll the page behind the popover
    list.scrollTop = Math.max(0, item.offsetTop - list.clientHeight / 2 + item.offsetHeight / 2);
  }, [selected]);

  return (
    <div className="grid gap-2">
      <span className="text-center text-[0.65rem] uppercase text-muted-foreground">{label}</span>
      <div
        ref={listRef}
        className="relative max-h-60 overflow-y-auto [scrollbar-color:var(--input)_transparent] [scrollbar-width:thin] [&::-webkit-scrollbar]:w-1 [&::-webkit-scrollbar-thumb]:bg-input"
      >
        {options.map((option) => (
          <button
            key={option}
            type="button"
            data-selected={option === selected}
            className={cn(
              "flex h-8 w-12 items-center justify-center rounded-full text-sm text-muted-foreground hover:bg-accent hover:text-foreground",
              option === selected && "bg-primary text-primary-foreground hover:bg-primary",
            )}
            onClick={() => onSelect(option)}
          >
            {option}
          </button>
        ))}
      </div>
    </div>
  );
}

function TimeColumns({ value, onHourChange, onMinuteChange }: TimeColumnsProps) {
  const [hour = "", minute = ""] = value.split(":");

  return (
    <div className="flex gap-3">
      <TimeColumn label="Hora" options={hours} selected={hour} onSelect={onHourChange} />
      <TimeColumn label="Min" options={minutes} selected={minute} onSelect={onMinuteChange} />
    </div>
  );
}

interface TimePickerProps {
  id?: string;
  name: string;
  defaultValue?: string;
  placeholder?: string;
}

function TimePicker({
  id,
  name,
  defaultValue = "",
  placeholder = "Selecciona una hora",
}: TimePickerProps) {
  const [open, setOpen] = React.useState(false);
  const [value, setValue] = React.useState(defaultValue);
  const [hour = "", minute = ""] = value.split(":");

  function selectHour(nextHour: string) {
    setValue(`${nextHour}:${minute || "00"}`);
  }

  function selectMinute(nextMinute: string) {
    setValue(`${hour || "00"}:${nextMinute}`);
    setOpen(false);
  }

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          id={id}
          type="button"
          className="flex min-h-11 w-full items-center justify-between gap-2 rounded-none border border-input bg-transparent px-[0.8rem] py-[0.65rem] text-left text-sm text-foreground transition-[border-color,background-color] duration-200 focus:border-primary focus:bg-[#fffbf405] [@media(hover:hover)_and_(pointer:fine)]:hover:not-focus:border-[#b9b7b0]"
        >
          <span className={cn(!value && "text-muted-foreground")}>{value || placeholder}</span>
          <Clock
            aria-hidden="true"
            className="size-4 shrink-0 stroke-[1.5] text-muted-foreground"
          />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start">
        <TimeColumns value={value} onHourChange={selectHour} onMinuteChange={selectMinute} />
      </PopoverContent>
      <input type="hidden" name={name} value={value} />
    </Popover>
  );
}

export { TimeColumns, TimePicker };
export type { TimeColumnsProps };
