import type { Metadata } from "next";
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
import { RefreshAt } from "@/ui/refresh-at";

export const dynamic = "force-dynamic";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const event = (await getPublicEventBySlug(postgresEventRepository, slug)).value;

  if (
    !event ||
    event.phase === "DRAFT" ||
    buildRequestAccessViewModel(event).state !== "RESERVATION"
  ) {
    return {};
  }

  const title = "El clan está abierto · Clandestino";
  const description = `${formatPublicEventDate(event.startsAt, "es")}. Solicita tu lugar.`;

  return {
    title,
    description,
    openGraph: { title, description, type: "website", siteName: "Clandestino", locale: "es_SV" },
    twitter: { card: "summary_large_image", title, description },
  };
}

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
    if (viewModel.variant.state === "SCHEDULED") {
      return (
        <>
          <ClosedState variant={viewModel.variant} />
          <RefreshAt
            delayMs={viewModel.variant.opensAt.getTime() - readModel.databaseTime.getTime()}
          />
        </>
      );
    }
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
