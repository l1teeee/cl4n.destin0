import Link from "next/link";

import { getAdminAuditLog } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { parseAuditSearchParams } from "@/ui/admin/view-model";

export default async function AuditPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireAdmin("page");
  const query = parseAuditSearchParams(await searchParams);
  const result = await getAdminAuditLog(postgresEventRepository, { ...query, pageSize: 25 });
  const pages = Math.max(1, Math.ceil(result.value.total / result.value.pageSize));
  const filter = query.entityType ? `&entityType=${query.entityType}` : "";

  return (
    <main className="mx-auto w-full max-w-7xl space-y-6 px-4 py-8">
      <div>
        <h1 className="text-3xl font-semibold">Auditoría</h1>
        <p className="mt-1 text-zinc-400">Actividad global, de la más reciente a la más antigua.</p>
      </div>
      <form className="flex items-end gap-3" method="get">
        <label className="grid gap-1 text-sm">
          <span>Tipo de entidad</span>
          <select
            className="rounded border border-zinc-700 bg-zinc-950 px-3 py-2"
            name="entityType"
            defaultValue={query.entityType ?? ""}
          >
            <option value="">Todas</option>
            <option value="EVENT">Experiencia</option>
            <option value="RESERVATION">Reservación</option>
            <option value="ADMIN_USER">Administrador</option>
          </select>
        </label>
        <button className="rounded border border-zinc-600 px-3 py-2" type="submit">
          Filtrar
        </button>
      </form>
      <AuditLogTable items={result.value.items} />
      <nav className="flex items-center gap-4" aria-label="Paginación">
        <span>
          Página {result.value.page} de {pages}
        </span>
        {result.value.page > 1 ? (
          <Link className="underline" href={`/admin/audit?page=${result.value.page - 1}${filter}`}>
            Anterior
          </Link>
        ) : null}
        {result.value.page < pages ? (
          <Link className="underline" href={`/admin/audit?page=${result.value.page + 1}${filter}`}>
            Siguiente
          </Link>
        ) : null}
      </nav>
    </main>
  );
}
