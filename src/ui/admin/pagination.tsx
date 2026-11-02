import Link from "next/link";
import type { ReactNode } from "react";

import { cn } from "@/ui/cn";

interface PaginationProps {
  page: number;
  total: number;
  pageSize: number;
  pageHref: (page: number) => string;
}

const VISIBLE_PAGE_COUNT = 5;

const controlClassName =
  "inline-flex min-h-11 min-w-9 items-center justify-center px-2 text-sm text-[#8d8b85] no-underline transition-colors duration-200";

const interactiveControlClassName =
  "[@media(hover:hover)_and_(pointer:fine)]:hover:text-primary focus-visible:text-primary";

function visiblePageNumbers(page: number, pages: number): number[] {
  const count = Math.min(VISIBLE_PAGE_COUNT, pages);
  const first = Math.max(1, Math.min(page - 2, pages - VISIBLE_PAGE_COUNT + 1));

  return Array.from({ length: count }, (_, index) => first + index);
}

function pageRange(page: number, pageSize: number, total: number): { first: number; last: number } {
  return {
    first: total === 0 ? 0 : (page - 1) * pageSize + 1,
    last: Math.min(page * pageSize, total),
  };
}

function PageControl({
  href,
  label,
  className,
  children,
}: {
  href: string | null;
  label: string;
  className?: string;
  children: ReactNode;
}) {
  if (href === null) {
    return (
      <span
        role="link"
        aria-label={label}
        aria-disabled="true"
        className={cn(controlClassName, "opacity-40", className)}
      >
        {children}
      </span>
    );
  }

  return (
    <Link
      href={href}
      aria-label={label}
      className={cn(controlClassName, interactiveControlClassName, className)}
    >
      {children}
    </Link>
  );
}

export function Pagination({ page, total, pageSize, pageHref }: PaginationProps) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const range = pageRange(page, pageSize, total);
  const hasPrevious = page > 1;
  const hasNext = page < pages;

  return (
    <nav
      aria-label="Paginación"
      className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between"
    >
      <span className="admin-secondary text-sm whitespace-nowrap" aria-live="polite">
        {range.first}-{range.last} de {total}
      </span>
      <div className="flex items-center gap-1">
        <PageControl
          href={hasPrevious ? pageHref(1) : null}
          label="Primera página"
          className="max-sm:hidden"
        >
          &laquo;
        </PageControl>
        <PageControl href={hasPrevious ? pageHref(page - 1) : null} label="Página anterior">
          &lsaquo;
        </PageControl>
        {visiblePageNumbers(page, pages).map((pageNumber) => (
          <Link
            key={pageNumber}
            href={pageHref(pageNumber)}
            aria-label={`Página ${pageNumber}`}
            aria-current={pageNumber === page ? "page" : undefined}
            className={cn(
              controlClassName,
              interactiveControlClassName,
              pageNumber === page &&
                "font-bold text-primary underline decoration-1 underline-offset-8",
            )}
          >
            {pageNumber}
          </Link>
        ))}
        <PageControl href={hasNext ? pageHref(page + 1) : null} label="Página siguiente">
          &rsaquo;
        </PageControl>
        <PageControl
          href={hasNext ? pageHref(pages) : null}
          label="Última página"
          className="max-sm:hidden"
        >
          &raquo;
        </PageControl>
      </div>
    </nav>
  );
}
