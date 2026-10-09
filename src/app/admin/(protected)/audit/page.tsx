import Link from "next/link";

import { getAdminAuditLog } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { parseAuditSearchParams } from "@/ui/admin/view-model";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";

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
    <main className="admin-page space-y-8">
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Auditoría</h1>
        <p className="admin-description">Actividad global, de la más reciente a la más antigua.</p>
      </div>
      <form className="flex items-end gap-3" method="get">
        <Label className="grid gap-2">
          <span>Tipo de entidad</span>
          <Select name="entityType" defaultValue={query.entityType ?? "todos"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todas</SelectItem>
              <SelectItem value="EVENT">Experiencia</SelectItem>
              <SelectItem value="RESERVATION">Reservación</SelectItem>
              <SelectItem value="ADMIN_USER">Administrador</SelectItem>
            </SelectContent>
          </Select>
        </Label>
        <Button variant="outline" type="submit">
          Filtrar
        </Button>
      </form>
      <AuditLogTable items={result.value.items} />
      <nav className="admin-muted flex items-center gap-4" aria-label="Paginación">
        <span className="admin-secondary">
          Página {result.value.page} de {pages}
        </span>
        {result.value.page > 1 ? (
          <Button variant="link" asChild>
            <Link href={`/admin/audit?page=${result.value.page - 1}${filter}`}>Anterior</Link>
          </Button>
        ) : null}
        {result.value.page < pages ? (
          <Button variant="link" asChild>
            <Link href={`/admin/audit?page=${result.value.page + 1}${filter}`}>Siguiente</Link>
          </Button>
        ) : null}
      </nav>
    </main>
  );
}
