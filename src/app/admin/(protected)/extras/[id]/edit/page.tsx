import Link from "next/link";
import { notFound } from "next/navigation";

import { updateExtraAction } from "@/app/admin/(protected)/extras/actions";
import { extraIdSchema } from "@/contracts/admin-extra";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresExtraRepository } from "@/infrastructure/db/repositories/postgres-extra-repository";
import { ExtraForm } from "@/ui/admin/extra-form";
import { Button } from "@/ui/primitives/button";

export default async function EditExtraPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin("page");
  const parsedId = extraIdSchema.safeParse((await params).id);
  if (!parsedId.success) notFound();
  const extra = await postgresExtraRepository.get(parsedId.data);
  if (!extra) notFound();

  return (
    <main className="admin-page space-y-8">
      <Button variant="link" className="admin-muted" asChild>
        <Link href="/admin/extras">Volver a extras</Link>
      </Button>
      <div>
        <p className="admin-eyebrow">Administración</p>
        <h1 className="admin-title">Editar extra</h1>
      </div>
      <ExtraForm mode="edit" extra={extra} action={updateExtraAction.bind(null, extra.id)} />
    </main>
  );
}
