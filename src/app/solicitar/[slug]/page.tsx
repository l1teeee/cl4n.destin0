import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { getPublicEventBySlug } from "@/application/events/event-use-cases";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { ClosedState } from "@/ui/public/closed-state";
import { buildRequestAccessViewModel } from "@/ui/public/home-view-model";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import { publicMessages } from "@/ui/public/i18n/messages";
import { ReservationExperience } from "@/ui/public/reservation-experience";

export const dynamic = "force-dynamic";

export default async function RequestAccessPage({ params }: { params: Promise<{ slug: string }> }) {
  const [{ slug }, requestHeaders] = await Promise.all([params, headers()]);
  const readModel = await getPublicEventBySlug(postgresEventRepository, slug);
  const event = readModel.value;

  if (!event || event.phase === "DRAFT") {
    notFound();
  }

  const viewModel = buildRequestAccessViewModel(event);
  if (viewModel.state === "NOT_FOUND") {
    notFound();
  }
  if (viewModel.state === "CLOSED") {
    return <ClosedState variant={viewModel.variant} />;
  }

  const locale = await getPublicLocale();
  return (
    <ReservationExperience
      eventSlug={event.slug}
      maxPartySize={event.maxPartySize}
      formattedDate={formatPublicEventDate(event.startsAt, locale)}
      locale={locale}
      messages={publicMessages[locale].reservation}
      nonce={requestHeaders.get("x-nonce") ?? undefined}
    />
  );
}
