import { getAdminEventList } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";

export default async function AdminPage() {
  await requireAdmin("page");
  const events = await getAdminEventList(postgresEventRepository);

  return (
    <main>
      <h1>Eventos</h1>
      <ul>
        {events.value.map((event) => (
          <li key={event.id}>
            {event.internalName}: {event.phase}
          </li>
        ))}
      </ul>
    </main>
  );
}
