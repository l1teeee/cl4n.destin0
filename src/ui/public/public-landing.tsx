import type { ReactNode } from "react";

import { BrandMark } from "./brand-mark";
import { PublicHeader } from "./public-header";

interface PublicLandingProps {
  status: string;
  showReservationLink?: boolean;
  children: ReactNode;
}

export function PublicLanding({
  status,
  showReservationLink = false,
  children,
}: PublicLandingProps) {
  return (
    <div className="public-page">
      <PublicHeader showReservationLink={showReservationLink} />
      <main className="public-home" id="reservar">
        <BrandMark className="public-home-mark" />
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{status}</h1>
        {children}
      </main>
    </div>
  );
}
