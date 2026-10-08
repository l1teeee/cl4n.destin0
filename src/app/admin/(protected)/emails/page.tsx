import Link from "next/link";

import { emailOutboxKinds } from "@/application/notifications/email-outbox";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import {
  emailKindLabel,
  emailStatusBadgeVariant,
  emailStatusFilters,
  emailStatusLabel,
  formatAdminDate,
  parseEmailLogSearchParams,
} from "@/ui/admin/view-model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";
import { NativeSelect } from "@/ui/primitives/native-select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";

import { retryEmailAction } from "./actions";

export default async function EmailsPage({
  searchParams = Promise.resolve({}),
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("page");
  const filters = parseEmailLogSearchParams(await searchParams);
  const [emails, totals] = await Promise.all([
    postgresEmailOutboxRepository.listRecent({ limit: 200, ...filters }),
    postgresEmailOutboxRepository.countByStatusSince(7),
  ]);

  return (
    <main className="admin-page space-y-8">
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Correos</h1>
        <p className="admin-description">
          Últimos 7 días: {totals.PENDING} pendientes, {totals.SENT} enviados, {totals.FAILED}{" "}
          fallidos.
        </p>
      </div>

      <form className="flex flex-wrap items-end gap-3" method="get">
        <Label className="grid gap-2">
          <span>Estado</span>
          <NativeSelect name="estado" defaultValue={filters.status ?? ""}>
            {emailStatusFilters.map((filter) => (
              <option key={filter.status ?? "todos"} value={filter.status ?? ""}>
                {filter.label}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Label className="grid gap-2">
          <span>Tipo</span>
          <NativeSelect name="tipo" defaultValue={filters.kind ?? ""}>
            <option value="">Todos</option>
            {emailOutboxKinds.map((kind) => (
              <option key={kind} value={kind}>
                {emailKindLabel(kind)}
              </option>
            ))}
          </NativeSelect>
        </Label>
        <Button variant="outline" type="submit">
          Aplicar
        </Button>
        <Button variant="link" asChild>
          <Link href="/admin/emails">Limpiar filtros</Link>
        </Button>
      </form>

      {emails.length === 0 ? (
        <p className="admin-empty">No hay correos con estos filtros.</p>
      ) : (
        <Table className="min-w-[1250px]">
          <TableHeader>
            <TableRow>
              {[
                "Fecha",
                "Tipo",
                "Destinatario",
                "Estado",
                "Intentos",
                "Último error",
                "Enviado",
                "Próximo intento",
                "Acciones",
              ].map((heading) => (
                <TableHead key={heading}>{heading}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {emails.map((email, index) => (
              <TableRow
                className="animate-in fill-mode-both fade-in-0 slide-in-from-bottom-1 align-top duration-300"
                key={email.id}
                style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
              >
                <TableCell>{formatAdminDate(email.createdAt)}</TableCell>
                <TableCell>{emailKindLabel(email.kind)}</TableCell>
                <TableCell>{email.recipientEmail}</TableCell>
                <TableCell>
                  <Badge variant={emailStatusBadgeVariant(email.status)}>
                    {emailStatusLabel(email.status)}
                  </Badge>
                </TableCell>
                <TableCell>{email.attempts}</TableCell>
                <TableCell className={email.status === "FAILED" ? "text-destructive" : undefined}>
                  {email.lastError ?? "-"}
                </TableCell>
                <TableCell>{formatAdminDate(email.sentAt)}</TableCell>
                <TableCell>
                  {email.status === "PENDING" ? formatAdminDate(email.nextAttemptAt) : "-"}
                </TableCell>
                <TableCell>
                  {email.status === "FAILED" ? (
                    <MutationForm
                      action={retryEmailAction.bind(null, email.id)}
                      label="Reintentar"
                    />
                  ) : null}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
