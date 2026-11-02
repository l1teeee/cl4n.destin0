import { LightPage } from "./light-page-transition";
import type { PublicLocale, PublicMessages } from "./i18n/messages";
import { PublicHeader } from "./public-header";
import { ReservationForm } from "./reservation-form";

interface ReservationExperienceProps {
  eventSlug: string;
  maxPartySize: number;
  formattedDate: string;
  locale: PublicLocale;
  messages: PublicMessages["reservation"];
  nonce?: string;
}

export function ReservationExperience(props: ReservationExperienceProps) {
  return (
    <LightPage>
      <PublicHeader />
      <main className="reservation-page">
        <div className="reservation-intro">
          <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
          <h1>{props.messages.title}</h1>
          <p className="reservation-date">{props.formattedDate}</p>
          <p className="public-eyebrow reservation-access">{props.messages.access}</p>
        </div>
        <ReservationForm {...props} />
      </main>
    </LightPage>
  );
}
