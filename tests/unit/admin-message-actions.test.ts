import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkContactByCode: vi.fn(),
  sendFreeText: vi.fn(),
  isBlockedByWaitingWindow: vi.fn(),
  scheduleMessageDelivery: vi.fn(),
  consume: vi.fn(),
  revalidatePath: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/application/messaging/admin-message-use-cases", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/application/messaging/admin-message-use-cases")>();
  return {
    ...actual,
    linkContactByCode: mocks.linkContactByCode,
    sendFreeText: mocks.sendFreeText,
  };
});
vi.mock("@/infrastructure/auth/require-admin", () => ({
  requireAdmin: vi.fn(async () => ({
    authorized: true,
    session: { admin: { id: "00000000-0000-4000-8000-000000000099" } },
  })),
}));
vi.mock("@/infrastructure/config/env", () => ({
  env: { APP_ENV: "test", MESSAGING_MODE: "log" },
}));
vi.mock("@/infrastructure/db/repositories/postgres-message-repository", () => ({
  postgresMessageRepository: {
    isBlockedByWaitingWindow: mocks.isBlockedByWaitingWindow,
  },
}));
vi.mock("@/infrastructure/rate-limit/postgres-rate-limiter", () => ({
  consume: mocks.consume,
}));
vi.mock("@/infrastructure/messaging/drain-message-outbox", () => ({
  drainMessagesNow: vi.fn(),
}));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  ingestConfiguredInstagramEvents: vi.fn(),
}));
vi.mock("@/infrastructure/messaging/schedule-message-delivery", () => ({
  scheduleMessageDelivery: mocks.scheduleMessageDelivery,
}));

const { linkContactByCodeAction, sendFreeTextAction } =
  await import("@/app/admin/(protected)/mensajes/actions");

const contactId = "00000000-0000-4000-8000-000000000010";

beforeEach(() => {
  mocks.linkContactByCode.mockReset();
  mocks.sendFreeText.mockReset();
  mocks.isBlockedByWaitingWindow.mockReset();
  mocks.scheduleMessageDelivery.mockReset();
  mocks.consume.mockReset().mockResolvedValue({ allowed: true });
  mocks.revalidatePath.mockClear();
});

describe("sendFreeTextAction", () => {
  it("explains when an older WAITING_WINDOW message blocks the new reply", async () => {
    mocks.sendFreeText.mockResolvedValue({
      ok: true,
      messageId: "00000000-0000-4000-8000-000000000011",
      status: "QUEUED",
      lastError: null,
    });
    mocks.isBlockedByWaitingWindow.mockResolvedValue(true);
    const formData = new FormData();
    formData.set("text", "Respuesta");

    await expect(
      sendFreeTextAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: true,
      message:
        "Hay mensajes anteriores esperando que la persona escriba; este saldrá después de ellos.",
    });
    expect(mocks.scheduleMessageDelivery).toHaveBeenCalledOnce();
  });
});

describe("linkContactByCodeAction", () => {
  it("uppercases a valid code and links it as MANUAL", async () => {
    mocks.linkContactByCode.mockResolvedValue(2);
    const formData = new FormData();
    formData.set("code", "abc234");

    await expect(
      linkContactByCodeAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: true,
      message: "Conversación vinculada.",
    });
    expect(mocks.linkContactByCode).toHaveBeenCalledWith(
      expect.objectContaining({
        isBlockedByWaitingWindow: mocks.isBlockedByWaitingWindow,
      }),
      contactId,
      "ABC234",
      "00000000-0000-4000-8000-000000000099",
    );
  });

  it("returns the required message when no request matches", async () => {
    mocks.linkContactByCode.mockResolvedValue(0);
    const formData = new FormData();
    formData.set("code", "ABC234");

    await expect(
      linkContactByCodeAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: false,
      message: "Ese código no corresponde a ninguna solicitud.",
    });
  });
});
