import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark";
import { getPublicLocale } from "./i18n/locale";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

interface PublicLandingProps {
  status: string;
  reservationHref?: string;
  children: ReactNode;
}

export async function PublicLanding({ status, reservationHref, children }: PublicLandingProps) {
  const locale = await getPublicLocale();
  return (
    <div className="public-page public-page-landing">
      <PublicHeader {...(reservationHref ? { reservationHref } : {})} />
      <main className="public-home">
        <BrandMark className="public-home-mark" />
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{status}</h1>
        {children}
      </main>
      <PublicFooter locale={locale} />
    </div>
  );
}
