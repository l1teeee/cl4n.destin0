import type { ReactNode } from "react";

import { PointerLight } from "./pointer-light";
import { PublicHeader } from "./public-header";
import { WatchingMark } from "./watching-mark";

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
      <PointerLight />
      <PublicHeader showReservationLink={showReservationLink} />
      <main className="public-home" id="reservar">
        <WatchingMark className="public-home-mark" />
        <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
        <h1>{status}</h1>
        {children}
      </main>
    </div>
  );
}
