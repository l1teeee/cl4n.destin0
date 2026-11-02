import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark";
import { PublicFooter } from "./public-footer";
import { PublicHeader } from "./public-header";

interface PublicLandingProps {
  status: string;
  reservationHref?: string;
  children: ReactNode;
}

export function PublicLanding({ status, reservationHref, children }: PublicLandingProps) {
  return (
    <div className="public-page public-page-landing">
      <PublicHeader {...(reservationHref ? { reservationHref } : {})} />
      <main className="public-home">
        <BrandMark className="public-home-mark" />
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{status}</h1>
        {children}
      </main>
      <PublicFooter />
    </div>
  );
}
