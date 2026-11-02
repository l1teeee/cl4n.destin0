import Link from "next/link";

import { createExtraAction } from "@/app/admin/(protected)/extras/actions";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { ExtraForm } from "@/ui/admin/extra-form";
import { Button } from "@/ui/primitives/button";

export default async function NewExtraPage() {
  await requireAdmin("page");
  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin/extras">Volver a extras</Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Nuevo extra</h1>
      </div>
      <ExtraForm mode="create" action={createExtraAction} />
    </main>
  );
}
