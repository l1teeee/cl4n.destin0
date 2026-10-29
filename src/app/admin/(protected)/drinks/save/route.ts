import { revalidatePath } from "next/cache";

import type { DrinkSaveResponse } from "@/app/admin/(protected)/drinks/read-drink-request";
import { readDrinkRequest } from "@/app/admin/(protected)/drinks/read-drink-request";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";

export async function POST(request: Request): Promise<Response> {
  const authorization = await requireAdmin("route");
  if (!authorization.authorized) {
    return Response.json(
      {
        ok: false,
        message: "Tu sesión no es válida. Inicia sesión nuevamente.",
      } satisfies DrinkSaveResponse,
      { status: 401 },
    );
  }

  const parsed = await readDrinkRequest(request);
  if (!parsed.ok) return parsed.response;

  const drink = await postgresDrinkRepository.create({
    ...parsed.fields,
    image: parsed.image,
    actorId: authorization.session.admin.id,
  });
  revalidatePath("/admin/drinks");
  revalidatePath("/bebidas");
  revalidatePath("/admin/audit");
  return Response.json(
    { ok: true, message: "Bebida creada.", id: drink.id } satisfies DrinkSaveResponse,
    { status: 201 },
  );
}
