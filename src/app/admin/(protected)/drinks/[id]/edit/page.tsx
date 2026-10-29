import Link from "next/link";
import { notFound } from "next/navigation";
import { z } from "zod";

import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";
import { DrinkForm } from "@/ui/admin/drink-form";
import { Button } from "@/ui/primitives/button";

const idSchema = z.string().uuid();

export default async function EditDrinkPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("page");
  const parsedId = idSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const drink = await postgresDrinkRepository.get(parsedId.data);
  if (!drink) notFound();

  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin/drinks">Volver a bebidas</Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Editar bebida</h1>
      </div>
      <DrinkForm mode="edit" drink={drink} />
    </main>
  );
}
