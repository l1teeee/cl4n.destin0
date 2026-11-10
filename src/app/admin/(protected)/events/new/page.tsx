import Link from "next/link";

import { createEventAction } from "@/app/admin/(protected)/events/actions";
import { loadPaymentSettings } from "@/application/payments/payment-settings";
import { roundUpToNextMinute } from "@/domain/event/event-schedule";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { postgresPaymentSettingsRepository } from "@/infrastructure/db/repositories/postgres-payment-settings-repository";
import { formatUtcForElSalvador } from "@/infrastructure/time/el-salvador-time";
import { EventForm } from "@/ui/admin/event-form";
import { LinkPendingIndicator } from "@/ui/admin/link-pending";
import { Button } from "@/ui/primitives/button";

export default async function NewEventPage() {
  await requireAdmin("page");
  const paymentSettings = await loadPaymentSettings(postgresPaymentSettingsRepository);
  const databaseTime = await postgresEventRepository.databaseTime();
  const suggestedOpensAt = formatUtcForElSalvador(
    roundUpToNextMinute(databaseTime),
    "yyyy-MM-dd'T'HH:mm",
  );
  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin">
          Volver a experiencias
          <LinkPendingIndicator />
        </Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Nueva experiencia</h1>
        <p className="admin-description">
          Todas las fechas y horas se ingresan en horario de El Salvador.
        </p>
      </div>
      <EventForm
        action={createEventAction}
        mode="create"
        paymentSettings={paymentSettings}
        suggestedOpensAt={suggestedOpensAt}
      />
    </main>
  );
}
