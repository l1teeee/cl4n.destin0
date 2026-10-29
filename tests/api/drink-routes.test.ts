import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  authorized: true,
  createInput: null as Record<string, unknown> | null,
  updateInput: null as Record<string, unknown> | null,
  updateExists: true,
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/infrastructure/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () =>
    state.authorized
      ? {
          authorized: true,
          session: { admin: { id: "00000000-0000-4000-8000-000000000001" } },
        }
      : { authorized: false, error: "UNAUTHORIZED" },
  ),
}));

vi.mock("@/infrastructure/db/repositories/postgres-drink-repository", () => ({
  postgresDrinkRepository: {
    create: vi.fn(async (input: Record<string, unknown>) => {
      state.createInput = input;
      return { id: "00000000-0000-4000-8000-000000000020" };
    }),
    update: vi.fn(async (input: Record<string, unknown>) => {
      state.updateInput = input;
      return state.updateExists ? { id: input.id } : null;
    }),
  },
}));

const { POST: createDrink } = await import("@/app/admin/(protected)/drinks/save/route");
const { POST: updateDrink } = await import("@/app/admin/(protected)/drinks/[id]/save/route");

const drinkId = "00000000-0000-4000-8000-000000000010";
const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0x04, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

function request(
  path: string,
  options: {
    headers?: HeadersInit;
    image?: Uint8Array;
    name?: string;
    price?: string;
    removeImage?: boolean;
  } = {},
): Request {
  const formData = new FormData();
  formData.set("name", options.name ?? "Vino de la casa");
  formData.set("description", "Copa");
  formData.set("price", options.price ?? "4.50");
  formData.set("isVisible", "on");
  if (options.removeImage) formData.set("removeImage", "on");
  if (options.image) {
    formData.set(
      "image",
      new File([options.image.slice().buffer as ArrayBuffer], "drink.webp", {
        type: "application/octet-stream",
      }),
    );
  }
  return new Request(`http://localhost${path}`, {
    method: "POST",
    headers: { origin: "http://localhost", ...options.headers },
    body: formData,
  });
}

beforeEach(() => {
  state.authorized = true;
  state.createInput = null;
  state.updateInput = null;
  state.updateExists = true;
});

describe("admin drink routes", () => {
  it("returns 401 without an admin session", async () => {
    state.authorized = false;
    const response = await createDrink(request("/admin/drinks/save"));
    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(state.createInput).toBeNull();
  });

  it("returns 401 for an update without an admin session", async () => {
    state.authorized = false;
    const response = await updateDrink(request(`/admin/drinks/${drinkId}/save`), {
      params: Promise.resolve({ id: drinkId }),
    });
    expect(response.status).toBe(401);
    expect(state.updateInput).toBeNull();
  });

  it.each([undefined, "https://evil.example"])("returns 403 for origin %s", async (origin) => {
    const drinkRequest = request("/admin/drinks/save");
    if (origin) drinkRequest.headers.set("origin", origin);
    else drinkRequest.headers.delete("origin");
    const response = await createDrink(drinkRequest);
    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ ok: false, message: "Origen no permitido." });
    expect(state.createInput).toBeNull();
  });

  it.each([
    ["local", "http://127.0.0.1:3000", "127.0.0.1:3000", "http"],
    ["production", "https://clandestino-nine.vercel.app", "clandestino-nine.vercel.app", "https"],
  ])(
    "accepts the %s browser origin when Next normalizes the request URL",
    async (_label, origin, host, protocol) => {
      const response = await createDrink(
        request("/admin/drinks/save", {
          headers: { origin, host, "x-forwarded-proto": protocol },
        }),
      );
      expect(response.status).toBe(201);
      expect(state.createInput).not.toBeNull();
    },
  );

  it("rejects a foreign origin even when Host identifies the site", async () => {
    const response = await createDrink(
      request("/admin/drinks/save", {
        headers: {
          origin: "https://evil.example",
          host: "clandestino-nine.vercel.app",
          "x-forwarded-proto": "https",
        },
      }),
    );
    expect(response.status).toBe(403);
    expect(state.createInput).toBeNull();
  });

  it("returns 413 before reading an oversized request", async () => {
    const response = await createDrink(
      request("/admin/drinks/save", { headers: { "content-length": "2621441" } }),
    );
    expect(response.status).toBe(413);
    expect(await response.json()).toMatchObject({
      fieldErrors: { image: "La imagen es demasiado grande." },
    });
  });

  it("returns field errors for invalid fields", async () => {
    const response = await createDrink(request("/admin/drinks/save", { name: "", price: "bad" }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: {
        name: "El nombre es obligatorio.",
        price: "Escribe el precio con números, por ejemplo 4.50.",
      },
    });
    expect(state.createInput).toBeNull();
  });

  it("returns 415 for bytes that are not an image", async () => {
    const response = await createDrink(
      request("/admin/drinks/save", { image: new TextEncoder().encode("not-an-image") }),
    );
    expect(response.status).toBe(415);
    expect(await response.json()).toEqual({
      ok: false,
      message: "El archivo debe ser una imagen JPG, PNG o WebP.",
      fieldErrors: { image: "El archivo debe ser una imagen JPG, PNG o WebP." },
    });
    expect(state.createInput).toBeNull();
  });

  it("creates a drink with WebP bytes", async () => {
    const response = await createDrink(request("/admin/drinks/save", { image: webp }));
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Bebida creada.",
      id: "00000000-0000-4000-8000-000000000020",
    });
    expect(state.createInput).toMatchObject({
      name: "Vino de la casa",
      priceCents: 450,
      isVisible: true,
      image: { contentType: "image/webp" },
    });
    expect((state.createInput?.image as { data: Uint8Array }).data).toEqual(Buffer.from(webp));
  });

  it("ignores removeImage when creating", async () => {
    const response = await createDrink(request("/admin/drinks/save", { removeImage: true }));
    expect(response.status).toBe(201);
    expect(state.createInput).toMatchObject({ image: null });
  });

  it("returns 404 when updating an unknown drink", async () => {
    state.updateExists = false;
    const response = await updateDrink(request(`/admin/drinks/${drinkId}/save`), {
      params: Promise.resolve({ id: drinkId }),
    });
    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ ok: false, message: "No se encontró la bebida." });
  });

  it("returns 404 for a non-uuid update id", async () => {
    const response = await updateDrink(request("/admin/drinks/not-a-uuid/save"), {
      params: Promise.resolve({ id: "not-a-uuid" }),
    });
    expect(response.status).toBe(404);
    expect(state.updateInput).toBeNull();
  });

  it("keeps the current image when the form sends none", async () => {
    const response = await updateDrink(request(`/admin/drinks/${drinkId}/save`), {
      params: Promise.resolve({ id: drinkId }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      ok: true,
      message: "Bebida actualizada.",
      id: drinkId,
    });
    expect(state.updateInput).toMatchObject({ id: drinkId, image: { kind: "keep" } });
  });

  it("updates by removing the current image", async () => {
    const response = await updateDrink(
      request(`/admin/drinks/${drinkId}/save`, { removeImage: true }),
      { params: Promise.resolve({ id: drinkId }) },
    );
    expect(response.status).toBe(200);
    expect(state.updateInput).toMatchObject({ image: { kind: "remove" } });
  });

  it("lets a new image win over removeImage", async () => {
    const response = await updateDrink(
      request(`/admin/drinks/${drinkId}/save`, { image: webp, removeImage: true }),
      { params: Promise.resolve({ id: drinkId }) },
    );
    expect(response.status).toBe(200);
    expect(state.updateInput).toMatchObject({ image: { kind: "replace" } });
  });

  it("updates by replacing the image", async () => {
    const response = await updateDrink(request(`/admin/drinks/${drinkId}/save`, { image: webp }), {
      params: Promise.resolve({ id: drinkId }),
    });
    expect(response.status).toBe(200);
    expect(state.updateInput).toMatchObject({
      image: { kind: "replace", image: { contentType: "image/webp" } },
    });
    expect((state.updateInput?.image as { image: { data: Uint8Array } }).image.data).toEqual(
      Buffer.from(webp),
    );
  });
});
