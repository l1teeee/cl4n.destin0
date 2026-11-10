import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { getAdminEventDetail } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { GuestImportFlow } from "@/ui/admin/guest-import/guest-import-flow";
import { ImportFormatHelp } from "@/ui/admin/guest-import/import-format-help";
import { LinkPendingIndicator } from "@/ui/admin/link-pending";
import { Alert } from "@/ui/primitives/alert";
import { Button } from "@/ui/primitives/button";

interface ImportEventGuestsPageProps {
  params: Promise<{ id: string }>;
}

export default async function ImportEventGuestsPage({ params }: ImportEventGuestsPageProps) {
  await requireAdmin("page");
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();

  const result = await getAdminEventDetail(postgresEventRepository, id);
  const event = result.value;
  if (!event) notFound();

  const canImport =
    (event.status === "SCHEDULED" || event.status === "CLOSED") &&
    event.startsAt > result.databaseTime;

  return (
    <main className="admin-page space-y-8">
      <Button variant="outline" asChild>
        <Link href={`/admin/events/${id}`}>
          Volver a la experiencia
          <LinkPendingIndicator />
        </Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Importar solicitudes</p>
        <h1 className="admin-title">{event.internalName}</h1>
        <p className="admin-description">
          Sube las respuestas de Google Forms. Revisa la vista previa antes de importar.
        </p>
      </div>
      {canImport ? (
        <GuestImportFlow eventId={id} />
      ) : (
        <Alert>Solo puedes importar en experiencias publicadas que aún no empiezan.</Alert>
      )}
      <ImportFormatHelp />
    </main>
  );
}
