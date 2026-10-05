import Link from "next/link";

import { createEventAction } from "@/app/admin/(protected)/events/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { EventForm } from "@/ui/admin/event-form";

export default async function NewEventPage() {
  await requireAdmin("page");
  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <Link className="text-sm underline" href="/admin">
        Volver a experiencias
      </Link>
      <div>
        <h1 className="text-3xl font-semibold">Nueva experiencia</h1>
        <p className="mt-1 text-zinc-400">
          Todas las fechas y horas se ingresan en horario de El Salvador.
        </p>
      </div>
      <EventForm action={createEventAction} mode="create" />
    </main>
  );
}
