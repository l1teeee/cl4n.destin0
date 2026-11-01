import { describe, expect, it } from "vitest";

import type {
  ConversationDetail,
  ConversationSummary,
} from "@/application/messaging/conversation-queries";
import {
  conversationHeaderView,
  conversationHref,
  conversationListItemView,
  conversationTimeLabel,
  hasUnreadMessages,
  threadMessageView,
} from "@/ui/admin/messages/message-view-model";

const now = new Date("2026-11-14T18:00:00.000Z");

const summary: ConversationSummary = {
  contactId: "contact-1",
  username: "ana.ig",
  displayName: "Ana",
  lastMessagePreview: "Hola",
  lastActivityAt: new Date("2026-11-14T17:30:00.000Z"),
  unreadCount: 2,
  linkedRequests: [
    {
      id: "request-1",
      type: "RESERVATION",
      eventId: "event-1",
      eventName: "Cena",
      eventStartsAt: new Date("2026-11-15T01:00:00.000Z"),
      guests: ["Ana", "Luis"],
      instagramHandles: ["ana.ig", "luis.ig"],
      status: "CONFIRMED",
      stage: "ON_LIST",
    },
  ],
};

describe("message page view models", () => {
  it("keeps filters in conversation and pagination links", () => {
    expect(conversationHref("contact-1", { search: "ana", unlinkedOnly: true, page: 2 })).toBe(
      "/admin/mensajes?c=contact-1&q=ana&sinVincular=1&page=2",
    );
  });

  it("maps list identity, request label, time, unread count, and mismatch", () => {
    expect(
      conversationListItemView(summary, { search: "", unlinkedOnly: false, page: 1 }, now),
    ).toEqual({
      contactId: "contact-1",
      title: "Ana",
      username: "ana.ig",
      preview: "Hola",
      lastActivityLabel: "11:30",
      unreadCount: 2,
      linkedLabel: "Ana y Luis · sáb 14 nov",
      mismatch: false,
      href: "/admin/mensajes?c=contact-1",
    });

    expect(
      conversationListItemView(
        { ...summary, username: "otro" },
        { search: "", unlinkedOnly: false, page: 1 },
        now,
      ).mismatch,
    ).toBe(true);
  });

  it("uses Spanish relative and absolute labels", () => {
    expect(conversationTimeLabel(new Date("2026-11-14T15:00:00.000Z"), now)).toBe("09:00");
    expect(conversationTimeLabel(new Date("2026-11-13T15:00:00.000Z"), now)).toBe("ayer");
    expect(conversationTimeLabel(new Date("2026-11-01T15:00:00.000Z"), now)).toBe("1 nov");
  });

  it("maps the header window and linked event URL", () => {
    const detail: ConversationDetail = {
      contact: {
        id: summary.contactId,
        username: summary.username,
        displayName: summary.displayName,
        lastInboundAt: new Date("2026-11-14T17:00:00.000Z"),
        adminReadAt: null,
      },
      linkedRequests: summary.linkedRequests,
      messages: [],
    };
    expect(conversationHeaderView(detail, now)).toMatchObject({
      contactId: "contact-1",
      title: "Ana",
      windowOpen: true,
      windowClosesAt: new Date("2026-11-15T16:55:00.000Z"),
      linked: [
        {
          label: "Ana y Luis · sáb 14 nov",
          statusLabel: "En la lista",
          href: "/admin/events/event-1?seccion=reservaciones",
          mismatch: false,
        },
      ],
    });
  });

  it("detects unread inbound messages from the detail without needing the current list page", () => {
    expect(
      hasUnreadMessages({
        contact: {
          id: "contact-1",
          username: null,
          displayName: null,
          lastInboundAt: now,
          adminReadAt: new Date("2026-11-14T17:00:00.000Z"),
        },
        linkedRequests: [],
        messages: [
          {
            id: "message-1",
            direction: "INBOUND",
            kind: "INBOUND",
            source: "GUEST",
            status: "RECEIVED",
            body: "Hola",
            attachmentIds: [],
            attachmentUrls: [],
            lastError: null,
            sentAt: null,
            readAt: null,
            createdAt: new Date("2026-11-14T17:30:00.000Z"),
          },
        ],
      }),
    ).toBe(true);
  });

  it("maps inbound stored attachments and outbound URLs", () => {
    const base = {
      id: "message-1",
      kind: "INBOUND" as const,
      source: "GUEST" as const,
      status: "RECEIVED" as const,
      body: null,
      lastError: null,
      sentAt: null,
      readAt: null,
      createdAt: now,
    };
    expect(
      threadMessageView({
        ...base,
        direction: "INBOUND",
        attachmentIds: ["attachment-1"],
        attachmentUrls: [],
      }).imageSrcs,
    ).toEqual(["/admin/mensajes/adjuntos/attachment-1"]);
    expect(
      threadMessageView({
        ...base,
        direction: "OUTBOUND",
        kind: "FREE_TEXT",
        source: "ADMIN",
        status: "SENT",
        attachmentIds: [],
        attachmentUrls: ["https://example.test/image.jpg"],
      }).imageSrcs,
    ).toEqual(["https://example.test/image.jpg"]);
  });
});
