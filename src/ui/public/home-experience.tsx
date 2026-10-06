import Link from "next/link";

import type { HomeViewModel } from "./home-view-model";
import { PublicLanding } from "./public-landing";

interface HomeExperienceProps {
  viewModel: Extract<HomeViewModel, { state: "OPEN" }>;
}

export function HomeExperience({ viewModel }: HomeExperienceProps) {
  return (
    <PublicLanding status="EL CLAN ESTÁ ABIERTO" showReservationLink>
      <div className="public-events">
        {viewModel.events.map((event) => (
          <section key={event.slug} className="public-event">
            <p className="public-event-date">{event.formattedDate}</p>
            <p className="public-eyebrow">ACCESO LIMITADO</p>
            <Link href={`/solicitar/${event.slug}`} className="public-reserve-link">
              SOLICITAR ACCESO
            </Link>
          </section>
        ))}
      </div>
    </PublicLanding>
  );
}
