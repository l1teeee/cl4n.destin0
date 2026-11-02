import Link from "next/link";
import { Pencil, Trash2 } from "lucide-react";

import { deleteExtraAction } from "@/app/admin/(protected)/extras/actions";
import { listExtras } from "@/application/extras/extra-use-cases";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresExtraRepository } from "@/infrastructure/db/repositories/postgres-extra-repository";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";
import { Badge } from "@/ui/primitives/badge";
import { Button } from "@/ui/primitives/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/ui/primitives/table";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/ui/primitives/tooltip";

export default async function ExtrasPage() {
  await requireAdmin("page");
  const extras = await listExtras(postgresExtraRepository);

  return (
    <main className="admin-page space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Administración</p>
          <h1 className="admin-title">Extras</h1>
          <p className="admin-description">Catálogo de extras que se cobran durante la cena.</p>
        </div>
        <Button asChild>
          <Link href="/admin/extras/new">Nuevo extra</Link>
        </Button>
      </div>
      <ActionFeedbackProvider>
        {extras.length === 0 ? (
          <p className="admin-empty">Todavía no hay extras.</p>
        ) : (
          <Table className="min-w-[560px]">
            <TableHeader>
              <TableRow>
                {["Extra", "Precio", "Estado", "Acciones"].map((heading) => (
                  <TableHead key={heading}>{heading}</TableHead>
                ))}
              </TableRow>
            </TableHeader>
            <TableBody>
              {extras.map((extra) => (
                <TableRow key={extra.id} className="align-top">
                  <TableCell className="font-medium text-[#fffbf4]">{extra.name}</TableCell>
                  <TableCell>{formatDrinkPrice(extra.priceCents)}</TableCell>
                  <TableCell>
                    <Badge variant={extra.isActive ? "active" : "inactive"}>
                      {extra.isActive ? "Disponible" : "Oculto"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link href={`/admin/extras/${extra.id}/edit`} aria-label="Editar extra">
                              <Pencil />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar extra</TooltipContent>
                      </Tooltip>
                      <MutationForm
                        action={deleteExtraAction.bind(null, extra.id)}
                        icon={<Trash2 />}
                        danger
                        reportToSection
                        label="Eliminar extra"
                        confirmation={`"${extra.name}" dejará de ofrecerse. Los consumos ya registrados conservan su nombre y precio.`}
                      />
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </ActionFeedbackProvider>
    </main>
  );
}
