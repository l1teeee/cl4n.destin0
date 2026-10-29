import { revalidatePath } from "next/cache";
import { z } from "zod";

import type { DrinkImageChange } from "@/application/drinks/drink-repository";
import type { DrinkSaveResponse } from "@/app/admin/(protected)/drinks/read-drink-request";
import { readDrinkRequest } from "@/app/admin/(protected)/drinks/read-drink-request";
import { requireAdmin } from "@/infrastructure/auth/require-admin";
import { postgresDrinkRepository } from "@/infrastructure/db/repositories/postgres-drink-repository";

const idSchema = z.string().uuid();

function notFound(): Response {
  return Response.json(
    { ok: false, message: "No se encontró la bebida." } satisfies DrinkSaveResponse,
    { status: 404 },
  );
}

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> },
): Promise<Response> {
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

  const parsedId = idSchema.safeParse((await context.params).id);
  if (!parsedId.success) return notFound();
  const parsed = await readDrinkRequest(request);
  if (!parsed.ok) return parsed.response;

  let image: DrinkImageChange = { kind: "keep" };
  if (parsed.image) image = { kind: "replace", image: parsed.image };
  else if (parsed.removeImage) image = { kind: "remove" };

  const drink = await postgresDrinkRepository.update({
    id: parsedId.data,
    ...parsed.fields,
    image,
    actorId: authorization.session.admin.id,
  });
  if (!drink) return notFound();

  revalidatePath("/admin/drinks");
  revalidatePath("/bebidas");
  revalidatePath("/admin/audit");
  return Response.json({
    ok: true,
    message: "Bebida actualizada.",
    id: drink.id,
  } satisfies DrinkSaveResponse);
}
