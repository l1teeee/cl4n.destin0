import { describe, expect, it, vi } from "vitest";

import type { ConsumptionLine, EconomyGuest } from "@/application/economy/economy-repository";
import {
  buildTabMessages,
  sendGroupTabs,
  sendTabMessage,
  type SendTabMessageDependencies,
  type TabMessagePreviewDependencies,
} from "@/application/economy/tab-messages";
import type { MessageDeliverySummary } from "@/application/messaging/deliver-messages";
import type { MessageStatus } from "@/domain/messaging/message-types";

const activeLine: ConsumptionLine = {
  id: "consumption-1",
  source: "CUSTOM",
  itemName: "Café",
  unitPriceCents: 325,
  quantity: 2,
  totalCents: 650,
  createdAt: new Date("2030-11-23T01:30:00Z"),
  voidedAt: null,
};

function guest(overrides: Partial<EconomyGuest> = {}): EconomyGuest {
  return {
    reservationId: "reservation-1",
    reservationNumber: 1,
    slot: 1,
    fullName: "Ana López",
    instagram: "ana.lopez",
    stage: "PAID",
    totalCents: 650,
    settled: false,
    settledAt: null,
    lines: [activeLine],
    ...overrides,
  };
}

function previewDependencies() {
  return {
    findTemplateBody: vi
      .fn<TabMessagePreviewDependencies["findTemplateBody"]>()
      .mockResolvedValue("Hola {nombre}, {fecha}:\n{consumos}\nTotal: {total}\n{datos_pago}"),
    findPaymentSettings: vi
      .fn<TabMessagePreviewDependencies["findPaymentSettings"]>()
      .mockResolvedValue(null),
  };
}

describe("buildTabMessages", () => {
  it("returns null when the TAB template is missing", async () => {
    const dependencies = previewDependencies();
    dependencies.findTemplateBody.mockResolvedValue(null);

    await expect(
      buildTabMessages(dependencies, { eventDate: "22 de noviembre", guests: [guest()] }),
    ).resolves.toBeNull();
    expect(dependencies.findTemplateBody).toHaveBeenCalledWith("TAB");
    expect(dependencies.findPaymentSettings).toHaveBeenCalledOnce();
  });

  it("skips settled tabs, empty tabs and tabs with only voided lines", async () => {
    const voidedLine = { ...activeLine, voidedAt: new Date("2030-11-23T02:00:00Z") };
    await expect(
      buildTabMessages(previewDependencies(), {
        eventDate: "22 de noviembre",
        guests: [guest({ settled: true }), guest({ lines: [] }), guest({ lines: [voidedLine] })],
      }),
    ).resolves.toEqual([]);
  });

  it("renders one group bill with active lines and the titular's name", async () => {
    const dependencies = previewDependencies();
    dependencies.findPaymentSettings.mockResolvedValue({
      bankName: "Banco Demo",
      accountType: "Ahorro",
      accountNumber: "123",
      accountHolder: "Clandestino",
      paymentLink: null,
    });
    const previews = await buildTabMessages(dependencies, {
      eventDate: "22 de noviembre",
      guests: [
        guest(),
        guest({
          slot: 2,
          fullName: "Luis Pérez",
          totalCents: 425,
          lines: [
            { ...activeLine, voidedAt: new Date("2030-11-23T02:00:00Z") },
            {
              ...activeLine,
              id: "consumption-2",
              itemName: "Postre",
              quantity: 1,
              totalCents: 425,
            },
          ],
        }),
      ],
    });

    expect(previews).toEqual([
      {
        reservationId: "reservation-1",
        totalCents: 1075,
        text: "Hola Ana, 22 de noviembre:\nAna\n2 × Café: $6.50\nSubtotal: $6.50\n\nLuis\n1 × Postre: $4.25\nSubtotal: $4.25\nTotal: $10.75\nBanco: Banco Demo\nTipo de cuenta: Ahorro\nCuenta: 123\nTitular: Clandestino",
      },
    ]);
  });
});

const command = {
  eventId: "event-1",
  reservationId: "reservation-1",
  text: "  Cuenta editada por el admin\n  ",
  adminId: "admin-1",
};

function sendDependencies() {
  const summary: MessageDeliverySummary = {
    sent: 0,
    retried: 0,
    failed: 0,
    waitingWindow: 0,
    discarded: 0,
    outcomes: {},
  };
  return {
    consumeRateLimit: vi
      .fn<SendTabMessageDependencies["consumeRateLimit"]>()
      .mockResolvedValue({ allowed: true }),
    enqueueTabMessage: vi
      .fn<SendTabMessageDependencies["enqueueTabMessage"]>()
      .mockResolvedValue("message-1"),
    deliver: vi.fn<SendTabMessageDependencies["deliver"]>().mockResolvedValue(summary),
    getDeliveryState: vi
      .fn<SendTabMessageDependencies["getDeliveryState"]>()
      .mockResolvedValue({ status: "QUEUED", lastError: null }),
  };
}

describe("sendGroupTabs", () => {
  const previews = [
    { reservationId: "reservation-1", text: "Cuenta 1", totalCents: 650 },
    { reservationId: "reservation-2", text: "Cuenta 2", totalCents: 425 },
  ];
  const batch = { eventId: "event-1", adminId: "admin-1", reservationIds: null, previews };

  it("limits once, skips missing reservations and delivers the remaining messages", async () => {
    const dependencies = sendDependencies();
    dependencies.enqueueTabMessage.mockResolvedValueOnce("message-1").mockResolvedValueOnce(null);
    await expect(sendGroupTabs(dependencies, batch)).resolves.toEqual({
      ok: true,
      sent: 0,
      waiting: 1,
      failed: 0,
      skipped: 1,
    });
    expect(dependencies.consumeRateLimit).toHaveBeenCalledTimes(1);
    expect(dependencies.deliver).toHaveBeenCalledWith(["message-1"]);
  });

  it("rejects a limited batch before enqueuing", async () => {
    const dependencies = sendDependencies();
    dependencies.consumeRateLimit.mockResolvedValue({ allowed: false });
    await expect(sendGroupTabs(dependencies, batch)).resolves.toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    expect(dependencies.enqueueTabMessage).not.toHaveBeenCalled();
  });

  it("ignores unknown selections and reports an empty selection", async () => {
    const dependencies = sendDependencies();
    await expect(
      sendGroupTabs(dependencies, { ...batch, reservationIds: ["unknown"] }),
    ).resolves.toEqual({ ok: false, error: "NOTHING_TO_SEND" });
    expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
  });
});

describe("sendTabMessage", () => {
  it("trims the final text and sends it through the outbox", async () => {
    const dependencies = sendDependencies();
    await expect(sendTabMessage(dependencies, command)).resolves.toEqual({
      ok: true,
      messageId: "message-1",
      status: "QUEUED",
      lastError: null,
    });
    expect(dependencies.consumeRateLimit).toHaveBeenCalledWith("admin-1");
    expect(dependencies.enqueueTabMessage).toHaveBeenCalledWith({
      ...command,
      text: "Cuenta editada por el admin",
    });
    expect(dependencies.deliver).toHaveBeenCalledWith(["message-1"]);
    expect(dependencies.getDeliveryState).toHaveBeenCalledWith("message-1");
  });

  it.each(["", " \n ", "x".repeat(2001)])(
    "rejects invalid text before rate limiting (%#)",
    async (text) => {
      const dependencies = sendDependencies();
      await expect(sendTabMessage(dependencies, { ...command, text })).resolves.toEqual({
        ok: false,
        error: "INVALID_TEXT",
      });
      expect(dependencies.consumeRateLimit).not.toHaveBeenCalled();
      expect(dependencies.enqueueTabMessage).not.toHaveBeenCalled();
      expect(dependencies.deliver).not.toHaveBeenCalled();
    },
  );

  it.each([1, 2000])("accepts text of %i characters", async (length) => {
    const dependencies = sendDependencies();
    const result = await sendTabMessage(dependencies, { ...command, text: "x".repeat(length) });
    expect(result.ok).toBe(true);
  });

  it("rejects rate-limited sends without enqueuing", async () => {
    const dependencies = sendDependencies();
    dependencies.consumeRateLimit.mockResolvedValue({ allowed: false });
    await expect(sendTabMessage(dependencies, command)).resolves.toEqual({
      ok: false,
      error: "RATE_LIMITED",
    });
    expect(dependencies.enqueueTabMessage).not.toHaveBeenCalled();
    expect(dependencies.deliver).not.toHaveBeenCalled();
  });

  it("reports a missing reservation without attempting delivery", async () => {
    const dependencies = sendDependencies();
    dependencies.enqueueTabMessage.mockResolvedValue(null);
    await expect(sendTabMessage(dependencies, command)).resolves.toEqual({
      ok: false,
      error: "RESERVATION_NOT_FOUND",
    });
    expect(dependencies.deliver).not.toHaveBeenCalled();
    expect(dependencies.getDeliveryState).not.toHaveBeenCalled();
  });

  it.each<MessageStatus>(["SENT", "READ", "WAITING_WINDOW", "FAILED"])(
    "prefers the delivery outcome %s over the stored status",
    async (status) => {
      const dependencies = sendDependencies();
      dependencies.deliver.mockResolvedValue({
        sent: 0,
        retried: 0,
        failed: 0,
        waitingWindow: 0,
        discarded: 0,
        outcomes: { "message-1": status },
      });
      dependencies.getDeliveryState.mockResolvedValue({
        status: "QUEUED",
        lastError: "META_ERROR",
      });

      await expect(sendTabMessage(dependencies, command)).resolves.toEqual({
        ok: true,
        messageId: "message-1",
        status,
        lastError: "META_ERROR",
      });
    },
  );

  it("uses the stored delivery status when no outcome was returned", async () => {
    const dependencies = sendDependencies();
    dependencies.getDeliveryState.mockResolvedValue({ status: "WAITING_CONTACT", lastError: null });
    expect(await sendTabMessage(dependencies, command)).toMatchObject({
      ok: true,
      status: "WAITING_CONTACT",
      lastError: null,
    });
  });

  it("falls back to QUEUED when neither outcome nor stored state is available", async () => {
    const dependencies = sendDependencies();
    dependencies.getDeliveryState.mockResolvedValue(null);
    expect(await sendTabMessage(dependencies, command)).toEqual({
      ok: true,
      messageId: "message-1",
      status: "QUEUED",
      lastError: null,
    });
  });
});
