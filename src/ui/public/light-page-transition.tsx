"use client";

import * as Sentry from "@sentry/nextjs";
import Link from "next/link";
import { useLayoutEffect, useRef, type MouseEvent, type ReactNode } from "react";

const FADE_FLAG = "clandestino:reservation-fade";

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

// Only a navigation that opens the form in this tab should fade, so same-page anchors and
// new-tab clicks never leave a stale flag behind.
function markFadeFromHome(event: MouseEvent<HTMLAnchorElement>, href: string) {
  if (href.startsWith("#") || !isPlainLeftClick(event)) return;
  try {
    sessionStorage.setItem(FADE_FLAG, "1");
  } catch (error) {
    Sentry.captureException(error);
  }
}

function consumeFadeFlag(): boolean {
  try {
    const flagged = sessionStorage.getItem(FADE_FLAG) !== null;
    sessionStorage.removeItem(FADE_FLAG);
    return flagged;
  } catch (error) {
    Sentry.captureException(error);
    return false;
  }
}

interface ReservationLinkProps {
  href: string;
  className?: string;
  children: ReactNode;
}

export function ReservationLink({ href, className, children }: ReservationLinkProps) {
  return (
    <Link href={href} className={className} onClick={(event) => markFadeFromHome(event, href)}>
      {children}
    </Link>
  );
}

// The light page is rendered as is. Only a visit that comes from the home link starts dark and
// fades to light, which is decided before the first paint.
export function LightPage({ children }: { children: ReactNode }) {
  const pageRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (consumeFadeFlag()) {
      pageRef.current?.setAttribute("data-enter", "from-dark");
    }
  }, []);

  return (
    <div ref={pageRef} className="public-page public-page--light">
      {children}
    </div>
  );
}
