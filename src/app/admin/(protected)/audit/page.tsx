import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { userAgent } from "next/server";

import { getAdminAuditLog } from "@/application/events/event-use-cases";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEventRepository } from "@/infrastructure/db/repositories/postgres-event-repository";
import { AuditLogTable } from "@/ui/admin/audit-log-table";
import { Pagination } from "@/ui/admin/pagination";
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
  const page = result.value.page;
  const pageHref = (targetPage: number) => {
    const params = new URLSearchParams({ page: String(targetPage) });
    if (query.entityType) params.set("entityType", query.entityType);
    return `/admin/audit?${params.toString()}`;
  };

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
      <Pagination
        page={page}
        total={result.value.total}
        pageSize={result.value.pageSize}
        pageHref={pageHref}
      />
    </main>
  );
}
