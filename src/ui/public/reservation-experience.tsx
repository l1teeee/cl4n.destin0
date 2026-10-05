import { ReservationForm } from "./reservation-form";

interface ReservationExperienceProps {
  eventSlug: string;
  maxPartySize: number;
  formattedDate: string;
}

export function ReservationExperience(props: ReservationExperienceProps) {
  return (
    <main className="flex min-h-screen flex-col items-center gap-8 px-6 py-16">
      <div className="text-center">
        <h1 className="text-4xl font-semibold tracking-[0.2em]">CLANDESTINO</h1>
        <p className="mt-4">{props.formattedDate}</p>
        <p className="mt-2 text-sm tracking-[0.18em]">ACCESO LIMITADO</p>
      </div>
      <ReservationForm {...props} />
    </main>
  );
}
