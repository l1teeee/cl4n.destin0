import { ReservationForm } from "./reservation-form";
import { PublicHeader } from "./public-header";

interface ReservationExperienceProps {
  eventSlug: string;
  maxPartySize: number;
  formattedDate: string;
  nonce?: string;
}

export function ReservationExperience(props: ReservationExperienceProps) {
  return (
    <div className="public-page">
      <PublicHeader />
      <main className="reservation-page">
        <div className="reservation-intro">
          <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
          <h1>SOLICITAR ACCESO</h1>
          <p className="reservation-date">{props.formattedDate}</p>
          <p className="public-eyebrow">ACCESO LIMITADO</p>
        </div>
        <ReservationForm {...props} />
      </main>
    </div>
  );
}
