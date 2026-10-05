import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getPublicEventBySlug } from "@/application/events/event-use-cases";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { ClosedState } from "@/ui/public/closed-state";
import { ReservationExperience } from "@/ui/public/reservation-experience";

export const dynamic = "force-dynamic";

export default async function RequestAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  const readModel = await getPublicEventBySlug(postgresEventRepository, slug);
  const event = readModel.value;

  if (!event) {
    notFound();
  }

  if (event.phase !== "OPEN") {
    return <ClosedState soldOut={event.phase === "FULL"} />;
  }

  return (
    <ReservationExperience
      eventSlug={event.slug}
      maxPartySize={event.maxPartySize}
      formattedDate={formatPublicEventDate(event.startsAt)}
      nonce={requestHeaders.get("x-nonce") ?? undefined}
    />
  );
}
