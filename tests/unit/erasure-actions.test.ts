import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requirePermission: vi.fn(),
  erase: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("@/infrastructure/auth/require-admin", () => ({
  requirePermission: mocks.requirePermission,
}));
vi.mock("@/infrastructure/db/repositories/guest-erasure", () => ({
  postgresGuestErasureRepository: { erase: mocks.erase },
}));

import { eraseGuestDataAction } from "@/app/admin/(protected)/events/erasure-actions";

const requestId = "7f1c2b3e-4d5a-4b6c-8d7e-9f0a1b2c3d4e";
const initialState = { ok: false, message: "" };
const formData = new FormData();

function authorizeAs(adminId: string): void {
  mocks.requirePermission.mockResolvedValue({
    authorized: true,
    session: { admin: { id: adminId } },
    token: "token",
  });
}

describe("eraseGuestDataAction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("asks for the privacy.erase permission before anything else", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });

    const result = await eraseGuestDataAction(
      { kind: "RESERVATION", id: requestId },
      initialState,
      formData,
    );

    expect(mocks.requirePermission).toHaveBeenCalledWith("privacy.erase", "action");
    expect(result.ok).toBe(false);
    expect(result.message).toBe("Solo un superadministrador puede borrar datos personales.");
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("rejects a missing session", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });

    const result = await eraseGuestDataAction(
      { kind: "RESERVATION", id: requestId },
      initialState,
      formData,
    );

    expect(result).toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it("rejects an identifier that is not a uuid", async () => {
    authorizeAs("admin-id");

    const result = await eraseGuestDataAction(
      { kind: "WAITLIST_ENTRY", id: "not-a-uuid" },
      initialState,
      formData,
    );

    expect(result).toEqual({ ok: false, message: "El identificador no es válido." });
    expect(mocks.erase).not.toHaveBeenCalled();
  });

  it.each([
    ["ERASED", true, "Datos borrados."],
    ["NOT_FOUND", false, "No se encontró la solicitud."],
    ["ACTIVE", false, "Cancela la solicitud antes de borrar sus datos."],
    ["ALREADY_ERASED", false, "Los datos de esta solicitud ya fueron borrados."],
    ["LIVE_LEASE", false, "Un mensaje se está enviando. Intenta de nuevo en unos segundos."],
  ])("answers %s", async (code, ok, message) => {
    authorizeAs("admin-id");
    mocks.erase.mockResolvedValue(code);

    const result = await eraseGuestDataAction(
      { kind: "RESERVATION", id: requestId },
      initialState,
      formData,
    );

    expect(result).toEqual({ ok, message });
    expect(mocks.erase).toHaveBeenCalledWith({ reservationId: requestId }, "admin-id");
    expect(mocks.revalidatePath).toHaveBeenCalledTimes(code === "ERASED" ? 3 : 0);
  });

  it("targets a waitlist entry by its own id", async () => {
    authorizeAs("admin-id");
    mocks.erase.mockResolvedValue("ERASED");

    await eraseGuestDataAction({ kind: "WAITLIST_ENTRY", id: requestId }, initialState, formData);

    expect(mocks.erase).toHaveBeenCalledWith({ waitlistEntryId: requestId }, "admin-id");
  });
});
