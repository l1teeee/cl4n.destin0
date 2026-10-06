import Link from "next/link";

import { BrandMark } from "./brand-mark";
import { RollingLabel } from "./rolling-label";

interface PublicHeaderProps {
  showReservationLink?: boolean;
  aboutHref?: string;
  aboutLabel?: string;
}

export function PublicHeader({
  showReservationLink = false,
  aboutHref = "/concepto",
  aboutLabel = "Qué es un supper clan",
}: PublicHeaderProps) {
  return (
    <header className="public-header">
      <Link href="/" className="public-header-brand" aria-label="Clandestino, inicio">
        <BrandMark className="public-header-mark" />
        <span>CLANDESTINO</span>
      </Link>
      <nav className="public-nav" aria-label="Navegación principal">
        {showReservationLink ? (
          <a href="#reservar">
            <RollingLabel>RSVP</RollingLabel>
          </a>
        ) : null}
        <a href={aboutHref}>
          <RollingLabel>{aboutLabel}</RollingLabel>
        </a>
      </nav>
    </header>
  );
}
