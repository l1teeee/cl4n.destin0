import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { getPublicEventBySlug } from "@/application/events/event-use-cases";
import { areCluesVisible, numberCluesNewestFirst } from "@/domain/event/event-clues";
import { postgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { CluesAutoRefresh } from "@/ui/public/clues-auto-refresh";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import { cluesMessages } from "@/ui/public/i18n/pages";
import { PublicHeader } from "@/ui/public/public-header";
import { PublicFooter } from "@/ui/public/public-footer";

import "../pistas.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pistas · Clandestino",
  robots: { index: false, follow: false },
};

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getPublicLocale();
  return {
    title: cluesMessages[locale].metaTitle,
    robots: { index: false, follow: false },
  };
}

export default async function CluesPage({ params }: { params: Promise<{ slug: string }> }) {
  const locale = await getPublicLocale();
  const messages = cluesMessages[locale];
  const { slug } = await params;
  const event = (await getPublicEventBySlug(postgresEventRepository, slug)).value;

  if (!event || event.phase === "DRAFT" || event.phase === "CANCELLED") {
    notFound();
  }

  const cluesVisible = areCluesVisible(event.phase);
  const clues = cluesVisible
    ? numberCluesNewestFirst(await postgresEventClueRepository.listForSlug(slug))
    : [];

  return (
    <div className="public-page">
      <PublicHeader aboutHref="/" />
      <main className="clues-page">
        <header className="clues-intro">
          <p className="public-eyebrow">{messages.eyebrow}</p>
          <h1>{messages.title}</h1>
          <p className="clues-date">{formatPublicEventDate(event.startsAt, locale)}</p>
        </header>
        {!cluesVisible ? (
          <p className="clues-empty">{messages.notStarted}</p>
        ) : clues.length > 0 ? (
          <ol className="clues-list">
            {clues.map((clue) => (
              <li className="clue-item" key={clue.id}>
                <p className="clue-label">{messages.clueLabel(clue.number)}</p>
                <p className="clue-body">{clue.body}</p>
                {clue.images.length > 0 ? (
                  <ul className="clue-images" aria-label={messages.imagesAriaLabel(clue.number)}>
                    {clue.images.map((image, index) => (
                      <li key={image.id}>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={`/pistas/${encodeURIComponent(slug)}/imagenes/${encodeURIComponent(image.id)}`}
                          alt={messages.imageAlt(index + 1, clue.number)}
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ol>
        ) : (
          <p className="clues-empty">{messages.empty}</p>
        )}
        {event.phase === "CLOSED" ? <CluesAutoRefresh /> : null}
      </main>
      <PublicFooter />
    </div>
  );
}
