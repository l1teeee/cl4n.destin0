import type { HomeViewModel } from "./home-view-model";
import { ReservationLink } from "./light-page-transition";
import { PublicLanding } from "./public-landing";

interface HomeExperienceProps {
  viewModel: Extract<HomeViewModel, { state: "OPEN" }>;
}

const steps = [
  {
    number: "01",
    title: "Solicita tu lugar",
    description: "Llena el formulario con tu usuario de Instagram.",
  },
  {
    number: "02",
    title: "Te escribimos",
    description: "Revisamos tu solicitud y te confirmamos por Instagram.",
  },
  {
    number: "03",
    title: "Recibe la ubicación",
    description: "La dirección llega por mensaje antes de la cena.",
  },
] as const;

export function HomeExperience({ viewModel }: HomeExperienceProps) {
  const [firstEvent, ...otherEvents] = viewModel.events;
  const reservationHref =
    firstEvent && otherEvents.length === 0 ? `/solicitar/${firstEvent.slug}` : "#eventos";

  return (
    <PublicLanding status="EL CLAN ESTÁ ABIERTO" reservationHref={reservationHref}>
      <div className="public-events" id="eventos">
        {viewModel.events.map((event) => (
          <article key={event.slug} className="public-event" aria-label={event.formattedDate}>
            <p className="public-eyebrow">{event.dateParts.weekday}</p>
            <p className="public-event-day">{event.dateParts.day}</p>
            <p className="public-event-when">
              <span className="public-event-month">{event.dateParts.month}</span>
              {" · "}
              {event.dateParts.time}
            </p>
            <p className="public-eyebrow public-event-access">
              {event.waitlistOnly ? "Cupos agotados · Aún hay lugar en la cola" : "Acceso limitado"}
            </p>
            <ReservationLink href={`/solicitar/${event.slug}`} className="public-cta">
              {event.waitlistOnly ? "Unirme a la cola" : "Solicitar acceso"}
            </ReservationLink>
          </article>
        ))}
      </div>

      <section className="public-steps" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="public-eyebrow">
          Cómo funciona
        </h2>
        <ol className="public-steps-list">
          {steps.map((step) => (
            <li key={step.number} className="public-step">
              <span className="public-step-number">{step.number}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>
    </PublicLanding>
  );
}
