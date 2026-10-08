import Link from "next/link";

import { createEventAction } from "@/app/admin/(protected)/events/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { EventForm } from "@/ui/admin/event-form";

export default async function NewEventPage() {
  await requireAdmin("page");
  return (
    <main className="admin-page space-y-8">
      <Link className="admin-link admin-muted" href="/admin">
        Volver a experiencias
      </Link>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Nueva experiencia</h1>
        <p className="admin-description">
          Todas las fechas y horas se ingresan en horario de El Salvador.
        </p>
      </div>
      <EventForm action={createEventAction} mode="create" />
    </main>
  );
}
