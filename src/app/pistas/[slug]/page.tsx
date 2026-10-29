import { notFound } from "next/navigation";

import { getPublicEventBySlug } from "@/application/events/event-use-cases";
import { areCluesVisible, numberCluesNewestFirst } from "@/domain/event/event-clues";
import { postgresEventClueRepository } from "@/infrastructure/db/repositories/postgres-event-clue-repository";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { CluesAutoRefresh } from "@/ui/public/clues-auto-refresh";
import { PublicHeader } from "@/ui/public/public-header";

import "../pistas.css";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Pistas · Clandestino",
  robots: { index: false, follow: false },
};

export default async function CluesPage({ params }: { params: Promise<{ slug: string }> }) {
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
      <PublicHeader aboutHref="/" aboutLabel="Inicio" />
      <main className="clues-page">
        <header className="clues-intro">
          <p className="public-eyebrow">CLANDESTINO SUPPER CLAN</p>
          <h1>Pistas</h1>
          <p className="clues-date">{formatPublicEventDate(event.startsAt)}</p>
        </header>
        {!cluesVisible ? (
          <p className="clues-empty">Las pistas aparecerán aquí cuando comience la experiencia.</p>
        ) : clues.length > 0 ? (
          <ol className="clues-list">
            {clues.map((clue) => (
              <li className="clue-item" key={clue.id}>
                <p className="clue-label">PISTA {clue.number}</p>
                <p className="clue-body">{clue.body}</p>
              </li>
            ))}
          </ol>
        ) : (
          <p className="clues-empty">Todavía no hay pistas. Mantente atento.</p>
        )}
        {event.phase === "CLOSED" ? <CluesAutoRefresh /> : null}
      </main>
    </div>
  );
}
