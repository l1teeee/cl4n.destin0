import { headers } from "next/headers";
import Link from "next/link";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";

import { getAdminAuditLog } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { auditPageSizeFor, parseAuditSearchParams } from "@/ui/admin/view-model";
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
  const { device } = userAgent({ headers: await headers() });
  let result = await getAdminAuditLog(postgresEventRepository, {
    ...query,
    pageSize: auditPageSizeFor(device.type),
  });
  if (query.page > 1 && result.value.items.length === 0) {
    const firstPage = await getAdminAuditLog(postgresEventRepository, {
      ...query,
      page: 1,
      pageSize: result.value.pageSize,
    });
    const lastPage = Math.max(1, Math.ceil(firstPage.value.total / firstPage.value.pageSize));
    if (query.page > lastPage) {
      const params = new URLSearchParams({ page: String(lastPage) });
      if (query.entityType) params.set("entityType", query.entityType);
      redirect(`/admin/audit?${params.toString()}`);
    }
    result = firstPage;
  }
  const pages = Math.max(1, Math.ceil(result.value.total / result.value.pageSize));
  const page = result.value.page;
  const firstVisiblePage = Math.max(1, Math.min(page - 2, pages - 4));
  const visiblePages = Array.from(
    { length: Math.min(5, pages) },
    (_, index) => firstVisiblePage + index,
  );
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (query.entityType) params.set("entityType", query.entityType);
    return `/admin/audit?${params.toString()}`;
  };
  const firstItem = result.value.total === 0 ? 0 : (page - 1) * result.value.pageSize + 1;
  const lastItem = Math.min(page * result.value.pageSize, result.value.total);

  return (
    <main className="admin-page space-y-8">
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Auditoría</h1>
        <p className="admin-description">Actividad global, de la más reciente a la más antigua.</p>
      </div>
      <form className="flex flex-wrap items-end gap-3" method="get">
        <Label className="grid w-full gap-2 sm:w-56">
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
      <nav
        className="admin-muted flex flex-wrap items-center gap-x-4 gap-y-2"
        aria-label="Paginación"
      >
        <span className="admin-secondary" aria-live="polite">
          Mostrando {firstItem}-{lastItem} de {result.value.total} actividades. Página {page} de{" "}
          {pages}.
        </span>
        {page > 1 ? (
          <Button variant="link" asChild>
            <Link href={pageHref(1)}>Primera</Link>
          </Button>
        ) : null}
        {page > 1 ? (
          <Button variant="link" asChild>
            <Link href={pageHref(page - 1)}>Anterior</Link>
          </Button>
        ) : null}
        {visiblePages.map((pageNumber) => (
          <Button key={pageNumber} variant="link" asChild>
            <Link
              href={pageHref(pageNumber)}
              aria-current={pageNumber === page ? "page" : undefined}
              aria-label={`Página ${pageNumber}`}
              className={pageNumber === page ? "font-bold text-primary" : undefined}
            >
              {pageNumber}
            </Link>
          </Button>
        ))}
        {page < pages ? (
          <Button variant="link" asChild>
            <Link href={pageHref(page + 1)}>Siguiente</Link>
          </Button>
        ) : null}
        {page < pages ? (
          <Button variant="link" asChild>
            <Link href={pageHref(pages)}>Última</Link>
          </Button>
        ) : null}
      </nav>
    </main>
  );
}
