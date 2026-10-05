import Link from "next/link";
import { notFound } from "next/navigation";

import { updateEventAction } from "@/app/admin/(protected)/events/actions";
import { getAdminEventDetail } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { EventForm } from "@/ui/admin/event-form";

export default async function EditEventPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("page");
  const { id } = await params;
  const result = await getAdminEventDetail(postgresEventRepository, id);
  const event = result.value;
  if (!event) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <Link className="text-sm underline" href={`/admin/events/${id}`}>
        Volver al detalle
      </Link>
      <div>
        <h1 className="text-3xl font-semibold">Editar experiencia</h1>
        <p className="mt-1 text-zinc-400">
          Todas las fechas y horas están en horario de El Salvador.
        </p>
      </div>
      <EventForm
        action={updateEventAction.bind(null, id)}
        mode="edit"
        slugEditable={event.status === "DRAFT"}
        values={{
          internalName: event.internalName,
          slug: event.slug,
          eventDate: formatUtcForElSalvador(event.startsAt, "yyyy-MM-dd"),
          eventTime: formatUtcForElSalvador(event.startsAt, "HH:mm"),
          opensAt: formatUtcForElSalvador(event.opensAt, "yyyy-MM-dd'T'HH:mm"),
          closesAt: formatUtcForElSalvador(event.closesAt, "yyyy-MM-dd'T'HH:mm"),
          maxPartySize: event.maxPartySize,
          autoCloseOnFull: event.autoCloseOnFull,
        }}
      />
    </main>
  );
}
