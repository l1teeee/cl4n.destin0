"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { es } from "date-fns/locale";
import { DayPicker } from "react-day-picker";

import { cn } from "@/ui/cn";

function Calendar({ className, classNames, ...props }: React.ComponentProps<typeof DayPicker>) {
  return (
    <DayPicker
      locale={es}
      navLayout="around"
      showOutsideDays
      className={cn("relative p-3", className)}
      classNames={{
        months: "flex flex-col",
        month: "relative",
        month_caption: "mb-3 flex h-9 items-center justify-center px-10",
        caption_label: "text-sm font-normal capitalize",
        nav: "absolute inset-x-3 top-3 flex h-9 items-center justify-between",
        button_previous:
          "absolute top-0 left-0 z-10 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30",
        button_next:
          "absolute top-0 right-0 z-10 inline-flex size-9 items-center justify-center rounded-full text-muted-foreground hover:bg-accent hover:text-foreground disabled:opacity-30",
        month_grid: "w-full border-collapse",
        weekdays: "flex",
        weekday: "w-9 text-center text-[0.65rem] font-normal uppercase text-muted-foreground",
        week: "mt-1 flex w-full",
        day: "relative size-9 p-0 text-center text-sm",
        day_button:
          "inline-flex size-9 items-center justify-center rounded-full text-sm text-foreground hover:bg-accent focus-visible:outline-2 focus-visible:outline-primary focus-visible:outline-offset-0",
        selected: "[&>button]:bg-primary [&>button]:text-primary-foreground",
        today: "[&>button]:ring-1 [&>button]:ring-input",
        outside: "opacity-30",
        disabled: "pointer-events-none opacity-30",
        hidden: "invisible",
        ...classNames,
      }}
      components={{
        Chevron: ({ orientation }) =>
          orientation === "left" ? (
            <ChevronLeft aria-hidden="true" className="size-4 stroke-[1.5]" />
          ) : (
            <ChevronRight aria-hidden="true" className="size-4 stroke-[1.5]" />
          ),
      }}
      {...props}
    />
  );
}

export { Calendar };
