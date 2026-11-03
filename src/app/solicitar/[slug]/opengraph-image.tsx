import { ImageResponse } from "next/og";
import { getPublicEventBySlug } from "@/application/events/event-use-cases";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { buildRequestAccessViewModel } from "@/ui/public/home-view-model";
import { OgCard } from "@/ui/public/og/og-card";
import { getOgFonts } from "@/ui/public/og/og-fonts";

export const alt = "El clan está abierto · Clandestino";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default async function Image({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const event = (await getPublicEventBySlug(postgresEventRepository, slug)).value;
  const visible =
    event && event.phase !== "DRAFT" && buildRequestAccessViewModel(event).state === "RESERVATION";

  return new ImageResponse(
    <OgCard
      dateLine={visible ? formatPublicEventDate(event.startsAt, "es") : null}
      footer={visible ? "Solicita tu lugar" : "Experiencias privadas"}
    />,
    { ...size, fonts: await getOgFonts() },
  );
}
