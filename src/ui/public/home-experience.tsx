import type { HomeViewModel } from "./home-view-model";
import type { PublicMessages } from "./i18n/messages";
import { ReservationLink } from "./light-page-transition";
import { PublicLanding } from "./public-landing";

interface HomeExperienceProps {
  viewModel: Extract<HomeViewModel, { state: "OPEN" }>;
  messages: PublicMessages["home"];
}

export function HomeExperience({ viewModel, messages }: HomeExperienceProps) {
  const [firstEvent, ...otherEvents] = viewModel.events;
  const reservationHref =
    firstEvent && otherEvents.length === 0 ? `/solicitar/${firstEvent.slug}` : "#eventos";

  return (
    <PublicLanding status={messages.open} reservationHref={reservationHref}>
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
              {event.waitlistOnly ? messages.full : messages.limited}
            </p>
            {event.waitlistOnly ? (
              <p className="public-event-helper">{messages.waitlistHelp}</p>
            ) : null}
            <ReservationLink href={`/solicitar/${event.slug}`} className="public-cta">
              {event.waitlistOnly ? messages.join : messages.request}
            </ReservationLink>
          </article>
        ))}
      </div>

      <section className="public-steps" aria-labelledby="como-funciona">
        <h2 id="como-funciona" className="public-eyebrow">
          {messages.how}
        </h2>
        <ol className="public-steps-list">
          {messages.steps.map((step, index) => (
            <li key={step.title} className="public-step">
              <span className="public-step-number">{String(index + 1).padStart(2, "0")}</span>
              <h3>{step.title}</h3>
              <p>{step.description}</p>
            </li>
          ))}
        </ol>
      </section>
    </PublicLanding>
  );
}
