"use client";

import { useReducedMotion } from "motion/react";

import CountUp from "@/ui/primitives/count-up";

import { formatCount } from "./view-model";

interface StatItem {
  label: string;
  value: string | number;
}

const countSeparator = formatCount(1000).replaceAll(/\d/g, "");

export function StatGrid({ items }: { items: StatItem[] }) {
  const reducedMotion = useReducedMotion();

  return (
    <dl className="grid grid-cols-2 border-t border-[#2b2c26] sm:grid-cols-4">
      {items.map((item) => (
        <div
          key={item.label}
          className="min-w-0 border-b border-[#2b2c26] px-4 py-5 odd:border-r sm:border-r sm:[&:nth-child(4n)]:border-r-0"
        >
          <dt className="text-[0.68rem] tracking-[0.2em] text-[#8d8b85] uppercase">{item.label}</dt>
          <dd className="mt-[0.4rem] text-[2rem] leading-[1.1] font-light text-foreground [overflow-wrap:anywhere]">
            {typeof item.value === "number" ? (
              <>
                <span aria-hidden="true">
                  <CountUp
                    from={reducedMotion ? item.value : 0}
                    to={item.value}
                    duration={0.8}
                    separator={countSeparator}
                  />
                </span>
                <span className="sr-only">{formatCount(item.value)}</span>
              </>
            ) : (
              item.value
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
