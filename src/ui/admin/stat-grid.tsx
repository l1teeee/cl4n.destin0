"use client";

import { Fragment } from "react";
import { useReducedMotion } from "motion/react";

import CountUp from "@/ui/primitives/count-up";

import { formatCount } from "./view-model";

interface StatItem {
  label: string;
  value: string | number;
  detail?: string;
}

interface StatGridProps {
  items: StatItem[];
  /** Smaller values in separate cards, for text such as names and emails. */
  compact?: boolean;
}

const countSeparator = formatCount(1000).replaceAll(/\d/g, "");

function breakAfterSeparators(text: string) {
  const parts = text.split(/(?<=[@.])/);

  return parts.map((part, index) => (
    <Fragment key={`${index}-${part}`}>
      {index > 0 ? <wbr /> : null}
      {part}
    </Fragment>
  ));
}

export function StatGrid({ items, compact = false }: StatGridProps) {
  const reducedMotion = useReducedMotion();

  return (
    <dl
      className={
        compact
          ? "grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4"
          : "grid grid-cols-2 border-t border-[#2b2c26] sm:grid-cols-4"
      }
    >
      {items.map((item) => (
        <div
          key={item.label}
          className={
            compact
              ? "min-w-0 border border-[#2b2c26] px-4 py-4"
              : "min-w-0 border-b border-[#2b2c26] px-4 py-5 odd:border-r sm:border-r sm:[&:nth-child(4n)]:border-r-0"
          }
        >
          <dt className="text-[0.68rem] tracking-[0.2em] text-[#8d8b85] uppercase">{item.label}</dt>
          <dd
            className={
              compact
                ? "mt-[0.4rem] text-[1.125rem] leading-[1.3] font-light text-foreground [overflow-wrap:anywhere]"
                : "mt-[0.4rem] text-[2rem] leading-[1.1] font-light text-foreground [overflow-wrap:anywhere]"
            }
          >
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
            ) : compact ? (
              breakAfterSeparators(item.value)
            ) : (
              item.value
            )}
            {item.detail ? (
              <span className="mt-1 block text-[0.8rem] leading-[1.3] text-[#8d8b85]">
                {item.detail}
              </span>
            ) : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
