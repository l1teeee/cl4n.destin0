import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  linkContact: vi.fn(),
  linkContactByCode: vi.fn(),
  sendFreeText: vi.fn(),
  isBlockedByWaitingWindow: vi.fn(),
  scheduleMessageDelivery: vi.fn(),
  consume: vi.fn(),
  revalidatePath: vi.fn(),
  requirePermission: vi.fn(),
  retryMessage: vi.fn(),
  markSentManually: vi.fn(),
  discardMessage: vi.fn(),
  unlinkContact: vi.fn(),
  deleteConversation: vi.fn(),
  redirect: vi.fn(() => {
    throw new Error("NEXT_REDIRECT");
  }),
  markConversationRead: vi.fn(),
  drainMessagesNow: vi.fn(),
  ingestConfiguredInstagramEvents: vi.fn(),
  updateTemplate: vi.fn(),
}));

vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidatePath }));
vi.mock("next/navigation", () => ({ redirect: mocks.redirect }));
vi.mock("next/server", () => ({ after: vi.fn() }));
vi.mock("@/application/messaging/admin-message-use-cases", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/application/messaging/admin-message-use-cases")>();
  return {
    ...actual,
    linkContact: mocks.linkContact,
    linkContactByCode: mocks.linkContactByCode,
    sendFreeText: mocks.sendFreeText,
    retryMessage: mocks.retryMessage,
    markSentManually: mocks.markSentManually,
    discardMessage: mocks.discardMessage,
    unlinkContact: mocks.unlinkContact,
    deleteConversation: mocks.deleteConversation,
    markConversationRead: mocks.markConversationRead,
  };
});
vi.mock("@/infrastructure/auth/require-admin", () => ({
  requirePermission: mocks.requirePermission,
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
  drainMessagesNow: mocks.drainMessagesNow,
}));
vi.mock("@/infrastructure/messaging/ingest-instagram-events", () => ({
  ingestConfiguredInstagramEvents: mocks.ingestConfiguredInstagramEvents,
}));
vi.mock("@/infrastructure/messaging/schedule-message-delivery", () => ({
  scheduleMessageDelivery: mocks.scheduleMessageDelivery,
}));

vi.mock("@/application/messaging/message-templates", () => ({
  updateTemplate: mocks.updateTemplate,
}));
vi.mock("@/infrastructure/db/repositories/postgres-message-template-repository", () => ({
  postgresMessageTemplateRepository: {},
}));

const { updateTemplateAction } = await import("@/app/admin/(protected)/mensajes/page-actions");
const {
  linkContactAction,
  linkContactByCodeAction,
  sendFreeTextAction,
  retryMessageAction,
  markSentManuallyAction,
  discardMessageAction,
  unlinkContactAction,
  deleteConversationAction,
  markConversationReadAction,
  simulateInboundMessageAction,
} = await import("@/app/admin/(protected)/mensajes/actions");

const contactId = "00000000-0000-4000-8000-000000000010";

beforeEach(() => {
  mocks.requirePermission.mockReset().mockResolvedValue({
    authorized: true,
    session: { admin: { id: "00000000-0000-4000-8000-000000000099", role: "SUPER_ADMIN" } },
  });
  mocks.retryMessage.mockReset();
  mocks.markSentManually.mockReset();
  mocks.discardMessage.mockReset();
  mocks.unlinkContact.mockReset();
  mocks.deleteConversation.mockReset();
  mocks.redirect.mockClear();
  mocks.markConversationRead.mockReset();
  mocks.drainMessagesNow.mockReset();
  mocks.ingestConfiguredInstagramEvents.mockReset();
  mocks.updateTemplate.mockReset();
  mocks.linkContact.mockReset();
  mocks.linkContactByCode.mockReset();
  mocks.sendFreeText.mockReset();
  mocks.isBlockedByWaitingWindow.mockReset();
  mocks.scheduleMessageDelivery.mockReset();
  mocks.consume.mockReset().mockResolvedValue({ allowed: true });
  mocks.revalidatePath.mockClear();
});

describe("message mutation authorization", () => {
  const state = { ok: false, message: "" };
  const forbidden = {
    ok: false,
    message: "Solo un superadministrador puede enviar o cambiar mensajes.",
  };
  const mutations = [
    sendFreeTextAction,
    retryMessageAction,
    markSentManuallyAction,
    discardMessageAction,
    linkContactAction,
    linkContactByCodeAction,
    unlinkContactAction,
    deleteConversationAction,
  ];

  function expectNoMutation() {
    for (const operation of [
      mocks.sendFreeText,
      mocks.retryMessage,
      mocks.markSentManually,
      mocks.discardMessage,
      mocks.linkContact,
      mocks.linkContactByCode,
      mocks.unlinkContact,
      mocks.deleteConversation,
      mocks.redirect,
      mocks.ingestConfiguredInstagramEvents,
      mocks.updateTemplate,
      mocks.drainMessagesNow,
      mocks.scheduleMessageDelivery,
      mocks.consume,
      mocks.revalidatePath,
    ]) {
      expect(operation).not.toHaveBeenCalled();
    }
  }

  it.each(mutations)("rejects ADMIN for %s before writing or sending", async (action) => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });
    await expect(action(contactId, state, new FormData())).resolves.toEqual(forbidden);
    expect(mocks.requirePermission).toHaveBeenCalledWith("messages.send", "action");
    expectNoMutation();
  });

  it("rejects ADMIN for simulateInboundMessageAction before ingestion", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });
    await expect(simulateInboundMessageAction(state, new FormData())).resolves.toEqual(forbidden);
    expectNoMutation();
  });

  it("rejects ADMIN for updateTemplateAction before writing", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });
    await expect(updateTemplateAction("ON_LIST", state, new FormData())).resolves.toEqual(
      forbidden,
    );
    expectNoMutation();
  });

  it("keeps the existing response for an unauthenticated sender", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });
    await expect(sendFreeTextAction(contactId, state, new FormData())).resolves.toEqual({
      ok: false,
      message: "Tu sesión no es válida. Inicia sesión nuevamente.",
    });
    expectNoMutation();
  });

  it("allows ADMIN to mark a conversation read", async () => {
    mocks.requirePermission.mockResolvedValue({ authorized: false, error: "FORBIDDEN" });
    mocks.markConversationRead.mockResolvedValue(true);
    await expect(markConversationReadAction(contactId, state, new FormData())).resolves.toEqual({
      ok: true,
      message: "Conversación marcada como leída.",
    });
    expect(mocks.markConversationRead).toHaveBeenCalledOnce();
    expect(mocks.requirePermission).not.toHaveBeenCalled();
  });
});

describe("deleteConversationAction", () => {
  const state = { ok: false, message: "" };

  it("rejects an invalid contact id before rate limiting or deleting", async () => {
    await expect(deleteConversationAction("invalid", state, new FormData())).resolves.toEqual({
      ok: false,
      message: "La conversación no es válida.",
    });
    expect(mocks.consume).not.toHaveBeenCalled();
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("limits deletions per admin", async () => {
    mocks.consume.mockResolvedValue({ allowed: false });
    await expect(deleteConversationAction(contactId, state, new FormData())).resolves.toEqual({
      ok: false,
      message: "Alcanzaste el límite de eliminaciones. Intenta más tarde.",
    });
    expect(mocks.consume).toHaveBeenCalledWith({
      scope: "admin-message:delete",
      subject: "00000000-0000-4000-8000-000000000099",
      limit: 30,
      windowSeconds: 600,
    });
    expect(mocks.deleteConversation).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it.each([
    ["NOT_FOUND", "No se encontró la conversación."],
    [
      "LINKED",
      "Esta conversación está vinculada a una solicitud. Desvincúlala antes de eliminarla.",
    ],
    [
      "HAS_REQUEST_MESSAGES",
      "Esta conversación tiene mensajes de una solicitud y no se puede eliminar.",
    ],
    [
      "LIVE_LEASE",
      "Un mensaje se está enviando en este momento. Intenta de nuevo en unos segundos.",
    ],
  ])("explains %s without refreshing or redirecting", async (result, message) => {
    mocks.deleteConversation.mockResolvedValue(result);
    await expect(deleteConversationAction(contactId, state, new FormData())).resolves.toEqual({
      ok: false,
      message,
    });
    expect(mocks.deleteConversation).toHaveBeenCalledWith(
      expect.objectContaining({ isBlockedByWaitingWindow: mocks.isBlockedByWaitingWindow }),
      contactId,
      "00000000-0000-4000-8000-000000000099",
    );
    expect(mocks.revalidatePath).not.toHaveBeenCalled();
    expect(mocks.redirect).not.toHaveBeenCalled();
  });

  it("refreshes messages and redirects to the list after deletion", async () => {
    mocks.deleteConversation.mockResolvedValue("DELETED");
    await expect(deleteConversationAction(contactId, state, new FormData())).rejects.toThrow(
      "NEXT_REDIRECT",
    );
    expect(mocks.revalidatePath.mock.calls).toEqual([
      ["/admin/mensajes"],
      ["/admin/mensajes/sin-enviar"],
      ["/admin"],
    ]);
    expect(mocks.redirect).toHaveBeenCalledExactlyOnceWith("/admin/mensajes");
    expect(mocks.revalidatePath.mock.invocationCallOrder.at(-1)).toBeLessThan(
      mocks.redirect.mock.invocationCallOrder[0]!,
    );
  });
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

describe("linkContactAction", () => {
  it("schedules delivery after a successful link", async () => {
    mocks.linkContact.mockResolvedValue(true);
    const formData = new FormData();
    formData.set("reservationId", "00000000-0000-4000-8000-000000000011");

    await expect(
      linkContactAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: true,
      message: "Conversación vinculada.",
    });
    expect(mocks.scheduleMessageDelivery).toHaveBeenCalledOnce();
  });

  it("does not schedule delivery when the link fails", async () => {
    mocks.linkContact.mockResolvedValue(false);
    const formData = new FormData();
    formData.set("reservationId", "00000000-0000-4000-8000-000000000011");

    await expect(
      linkContactAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: false,
      message: "No se pudo vincular la solicitud.",
    });
    expect(mocks.scheduleMessageDelivery).not.toHaveBeenCalled();
  });

  it("does not schedule delivery for invalid input", async () => {
    const formData = new FormData();
    formData.set("reservationId", "invalid");

    await expect(
      linkContactAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: false,
      message: "La vinculación no es válida.",
    });
    expect(mocks.linkContact).not.toHaveBeenCalled();
    expect(mocks.scheduleMessageDelivery).not.toHaveBeenCalled();
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
    expect(mocks.scheduleMessageDelivery).toHaveBeenCalledOnce();
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
    expect(mocks.scheduleMessageDelivery).not.toHaveBeenCalled();
  });

  it("does not schedule delivery for invalid input", async () => {
    const formData = new FormData();
    formData.set("code", "invalid");

    await expect(
      linkContactByCodeAction(contactId, { ok: false, message: "" }, formData),
    ).resolves.toEqual({
      ok: false,
      message: "El código de vinculación no es válido.",
    });
    expect(mocks.linkContactByCode).not.toHaveBeenCalled();
    expect(mocks.scheduleMessageDelivery).not.toHaveBeenCalled();
  });
});
