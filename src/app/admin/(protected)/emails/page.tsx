import Link from "next/link";

import { emailOutboxKinds } from "@/application/notifications/email-outbox";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import {
  emailKindLabel,
  emailStatusBadgeClass,
  emailStatusFilters,
  emailStatusLabel,
  formatAdminDate,
  parseEmailLogSearchParams,
} from "@/ui/admin/view-model";

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
        <label className="admin-label grid gap-2">
          <span>Estado</span>
          <select className="admin-input" name="estado" defaultValue={filters.status ?? ""}>
            {emailStatusFilters.map((filter) => (
              <option key={filter.status ?? "todos"} value={filter.status ?? ""}>
                {filter.label}
              </option>
            ))}
          </select>
        </label>
        <label className="admin-label grid gap-2">
          <span>Tipo</span>
          <select className="admin-input" name="tipo" defaultValue={filters.kind ?? ""}>
            <option value="">Todos</option>
            {emailOutboxKinds.map((kind) => (
              <option key={kind} value={kind}>
                {emailKindLabel(kind)}
              </option>
            ))}
          </select>
        </label>
        <button className="admin-button-ghost" type="submit">
          Aplicar
        </button>
        <Link className="admin-link" href="/admin/emails">
          Limpiar filtros
        </Link>
      </form>

      {emails.length === 0 ? (
        <p className="admin-empty">No hay correos con estos filtros.</p>
      ) : (
        <div className="admin-table-scroll">
          <table className="admin-table min-w-[1250px]">
            <thead>
              <tr>
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
                  <th key={heading}>{heading}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {emails.map((email) => (
                <tr className="align-top" key={email.id}>
                  <td>{formatAdminDate(email.createdAt)}</td>
                  <td>{emailKindLabel(email.kind)}</td>
                  <td>{email.recipientEmail}</td>
                  <td>
                    <span className={emailStatusBadgeClass(email.status)}>
                      {emailStatusLabel(email.status)}
                    </span>
                  </td>
                  <td>{email.attempts}</td>
                  <td className={email.status === "FAILED" ? "admin-notice-error" : undefined}>
                    {email.lastError ?? "-"}
                  </td>
                  <td>{formatAdminDate(email.sentAt)}</td>
                  <td>{email.status === "PENDING" ? formatAdminDate(email.nextAttemptAt) : "-"}</td>
                  <td>
                    {email.status === "FAILED" ? (
                      <MutationForm
                        action={retryEmailAction.bind(null, email.id)}
                        label="Reintentar"
                      />
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
