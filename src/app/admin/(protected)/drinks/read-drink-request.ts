import type { DrinkImageFile } from "@/application/drinks/drink-repository";
import { fieldErrorsFromZod } from "@/app/admin/(protected)/form-errors";
import { drinkFormSchema, readDrinkFormData, type DrinkFormInput } from "@/contracts/admin-drink";
import {
  detectImageContentType,
  isImageSizeValid,
  MAX_IMAGE_REQUEST_BYTES,
} from "@/contracts/image-upload";

export interface DrinkSaveResponse {
  ok: boolean;
  message: string;
  fieldErrors?: Record<string, string>;
  id?: string;
}

type ReadDrinkRequestResult =
  | {
      ok: true;
      fields: DrinkFormInput;
      image: DrinkImageFile | null;
      removeImage: boolean;
    }
  | { ok: false; response: Response };

function error(
  message: string,
  status: number,
  fieldErrors?: Record<string, string>,
): ReadDrinkRequestResult {
  return {
    ok: false,
    response: Response.json(
      { ok: false, message, ...(fieldErrors ? { fieldErrors } : {}) } satisfies DrinkSaveResponse,
      { status },
    ),
  };
}

export async function readDrinkRequest(request: Request): Promise<ReadDrinkRequestResult> {
  const origin = request.headers.get("origin");
  if (!origin || origin !== new URL(request.url).origin) {
    return error("Origen no permitido.", 403);
  }

  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (Number.isFinite(contentLength) && contentLength > MAX_IMAGE_REQUEST_BYTES) {
    return error("La imagen es demasiado grande.", 413, {
      image: "La imagen es demasiado grande.",
    });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return error("No se pudo leer el formulario.", 400);
  }

  const parsed = drinkFormSchema.safeParse(readDrinkFormData(formData));
  if (!parsed.success) {
    return error(
      "Revisa los campos marcados.",
      400,
      fieldErrorsFromZod(parsed.error) as Record<string, string>,
    );
  }

  const uploaded = formData.get("image");
  let image: DrinkImageFile | null = null;
  if (uploaded instanceof File && uploaded.size > 0) {
    if (!isImageSizeValid(uploaded.size)) {
      return error("La imagen es demasiado grande.", 413, {
        image: "La imagen es demasiado grande.",
      });
    }
    const data = Buffer.from(await uploaded.arrayBuffer());
    const contentType = detectImageContentType(data);
    if (!contentType) {
      return error("El archivo debe ser una imagen JPG, PNG o WebP.", 415, {
        image: "El archivo debe ser una imagen JPG, PNG o WebP.",
      });
    }
    image = { contentType, data };
  } else if (uploaded !== null && !(uploaded instanceof File)) {
    return error("El archivo debe ser una imagen JPG, PNG o WebP.", 415, {
      image: "El archivo debe ser una imagen JPG, PNG o WebP.",
    });
  }

  return {
    ok: true,
    fields: parsed.data,
    image,
    removeImage: formData.get("removeImage") === "on",
  };
}
