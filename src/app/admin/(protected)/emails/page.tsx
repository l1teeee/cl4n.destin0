import Link from "next/link";

import { emailOutboxKinds } from "@/application/notifications/email-outbox";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresEmailOutboxRepository } from "@/infrastructure/email/outbox/postgres-email-outbox-repository";
import { MutationForm } from "@/ui/admin/mutation-form";
import {
  emailKindLabel,
  emailErrorLabel,
  emailStatusBadgeVariant,
  emailStatusFilters,
  emailStatusLabel,
  formatAdminDate,
  parseEmailLogSearchParams,
} from "@/ui/admin/view-model";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import { Label } from "@/ui/primitives/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
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
  const params = await searchParams;
  const filters = parseEmailLogSearchParams(params);
  const rawPage = Number(Array.isArray(params.page) ? params.page[0] : params.page);
  const requestedPage = Number.isInteger(rawPage) && rawPage > 0 ? rawPage : 1;
  const pageSize = 25;
  const [total, totals] = await Promise.all([
    postgresEmailOutboxRepository.countRecent(filters),
    postgresEmailOutboxRepository.countByStatusSince(7),
  ]);
  const pages = Math.max(1, Math.ceil(total / pageSize));
  const page = Math.min(requestedPage, pages);
  const emails = await postgresEmailOutboxRepository.listRecent({
    limit: pageSize,
    offset: (page - 1) * pageSize,
    ...filters,
  });
  const firstVisiblePage = Math.max(1, Math.min(page - 2, pages - 4));
  const visiblePages = Array.from(
    { length: Math.min(5, pages) },
    (_, index) => firstVisiblePage + index,
  );
  const pageHref = (targetPage: number) => {
    const query = new URLSearchParams({ page: String(targetPage) });
    if (filters.status) query.set("estado", filters.status);
    if (filters.kind) query.set("tipo", filters.kind);
    return `/admin/emails?${query.toString()}`;
  };
  const firstItem = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastItem = Math.min(page * pageSize, total);

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
        <Label className="grid w-full gap-2 sm:w-48">
          <span>Estado</span>
          <Select name="estado" defaultValue={filters.status ?? "todos"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {emailStatusFilters.map((filter) => (
                <SelectItem key={filter.status ?? "todos"} value={filter.status ?? "todos"}>
                  {filter.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Label>
        <Label className="grid w-full gap-2 sm:w-56">
          <span>Tipo</span>
          <Select name="tipo" defaultValue={filters.kind ?? "todos"}>
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="todos">Todos</SelectItem>
              {emailOutboxKinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {emailKindLabel(kind)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
                  {emailErrorLabel(email.lastError)}
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
      <nav
        className="admin-muted flex flex-wrap items-center gap-x-4 gap-y-2"
        aria-label="Paginación"
      >
        <span className="admin-secondary" aria-live="polite">
          Mostrando {firstItem}-{lastItem} de {total} correos. Página {page} de {pages}.
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
