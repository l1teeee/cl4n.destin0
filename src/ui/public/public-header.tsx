import Link from "next/link";

import { BrandMark } from "./brand-mark";
import { ReservationLink } from "./light-page-transition";

interface PublicHeaderProps {
  reservationHref?: string;
  aboutHref?: string;
  aboutLabel?: string;
}

export function PublicHeader({
  reservationHref,
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
        {reservationHref ? <ReservationLink href={reservationHref}>RSVP</ReservationLink> : null}
        <a href={aboutHref}>{aboutLabel}</a>
      </nav>
    </header>
  );
}
