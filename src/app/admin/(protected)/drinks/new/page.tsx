import Link from "next/link";

import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { DrinkForm } from "@/ui/admin/drink-form";
import { Button } from "@/ui/primitives/button";

export default async function NewDrinkPage() {
  await requireAdmin("page");
  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin/drinks">Volver a bebidas</Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Nueva bebida</h1>
      </div>
      <DrinkForm mode="create" />
    </main>
  );
}
