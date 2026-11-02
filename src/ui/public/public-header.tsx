import Link from "next/link";

import { BrandMark } from "./brand-mark";
import { getPublicLocale } from "./i18n/locale";
import { publicMessages } from "./i18n/messages";
import { LanguageSwitch } from "./language-switch";
import { ReservationLink } from "./light-page-transition";

interface PublicHeaderProps {
  reservationHref?: string;
  aboutHref?: string;
  aboutLabel?: string;
}

export async function PublicHeader({
  reservationHref,
  aboutHref = "/concepto",
  aboutLabel,
}: PublicHeaderProps) {
  const locale = await getPublicLocale();
  const messages = publicMessages[locale].header;
  return (
    <header className="public-header">
      <Link href="/" className="public-header-brand" aria-label={messages.brandHome}>
        <BrandMark className="public-header-mark" />
        <span>CLANDESTINO</span>
      </Link>
      <nav className="public-nav" aria-label={messages.navigation}>
        {reservationHref ? <ReservationLink href={reservationHref}>RSVP</ReservationLink> : null}
        <a href={aboutHref}>{aboutHref === "/" ? messages.home : (aboutLabel ?? messages.about)}</a>
        <LanguageSwitch locale={locale} label={messages.language} />
      </nav>
    </header>
  );
}
