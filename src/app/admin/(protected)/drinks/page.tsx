import Link from "next/link";
import { ArrowUpRight, Pencil, Trash2 } from "lucide-react";

import { deleteDrinkAction } from "@/app/admin/(protected)/drinks/actions";
import { formatDrinkPrice } from "@/domain/drink/drink-price";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";
import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";
import { DrinkDetailsDialog } from "@/ui/drink-details-dialog";
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

export default async function DrinksPage() {
  await requireAdmin("page");
  const drinks = await postgresDrinkRepository.listForAdmin();

  return (
    <main className="admin-page space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="admin-eyebrow">Administración</p>
          <h1 className="admin-title">Bebidas</h1>
          <p className="admin-description">Menú de bebidas que ven los comensales.</p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            className="border-primary/60 bg-primary/10 px-5 text-[#fffbf4] hover:bg-primary/20 hover:opacity-100 focus-visible:bg-primary/20 focus-visible:opacity-100"
            asChild
          >
            <Link href="/bebidas" target="_blank" rel="noopener noreferrer">
              <ArrowUpRight aria-hidden="true" />
              Ver menú público
              <span className="sr-only"> (se abre en una pestaña nueva)</span>
            </Link>
          </Button>
          <Button asChild>
            <Link href="/admin/drinks/new">Nueva bebida</Link>
          </Button>
        </div>
      </div>
      <ActionFeedbackProvider>
        {drinks.length === 0 ? (
          <p className="admin-empty">Todavía no hay bebidas.</p>
        ) : (
          <Table className="min-w-[860px]">
            <TableHeader>
              <TableRow>
                {["Imagen", "Bebida", "Descripción", "Precio", "Menú", "Acciones"].map(
                  (heading) => (
                    <TableHead key={heading}>{heading}</TableHead>
                  ),
                )}
              </TableRow>
            </TableHeader>
            <TableBody>
              {drinks.map((drink) => (
                <TableRow key={drink.id} className="align-top">
                  <TableCell>
                    {drink.imageId ? (
                      /* eslint-disable-next-line @next/next/no-img-element */
                      <img
                        src={`/bebidas/imagen/${drink.imageId}`}
                        alt=""
                        className="size-12 object-cover"
                      />
                    ) : (
                      "-"
                    )}
                  </TableCell>
                  <TableCell>
                    <DrinkDetailsDialog
                      name={drink.name}
                      description={drink.description}
                      price={formatDrinkPrice(drink.priceCents)}
                      imageUrl={drink.imageId ? `/bebidas/imagen/${drink.imageId}` : null}
                      visibility={drink.isVisible ? "Visible" : "Oculta"}
                    >
                      <button
                        type="button"
                        className="cursor-pointer text-left font-medium text-[#fffbf4] underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {drink.name}
                        <span className="sr-only">: ver detalles</span>
                      </button>
                    </DrinkDetailsDialog>
                  </TableCell>
                  <TableCell className="max-w-sm whitespace-normal">
                    {drink.description ?? "-"}
                  </TableCell>
                  <TableCell>{formatDrinkPrice(drink.priceCents)}</TableCell>
                  <TableCell>
                    <Badge variant={drink.isVisible ? "active" : "inactive"}>
                      {drink.isVisible ? "Visible" : "Oculta"}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button variant="ghost" size="icon-sm" asChild>
                            <Link
                              href={`/admin/drinks/${drink.id}/edit`}
                              aria-label="Editar bebida"
                            >
                              <Pencil />
                            </Link>
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Editar bebida</TooltipContent>
                      </Tooltip>
                      <MutationForm
                        action={deleteDrinkAction.bind(null, drink.id)}
                        icon={<Trash2 />}
                        danger
                        reportToSection
                        label="Eliminar bebida"
                        confirmation={`"${drink.name}" desaparecerá del menú y su imagen se eliminará. Esta acción no se puede deshacer.`}
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
