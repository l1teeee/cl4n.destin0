import { describe, expect, it } from "vitest";

import { parseInstagramWebhook } from "@/infrastructure/instagram/instagram-webhook-parser";

const accountId = "1000";
const base = { sender: { id: "2000" }, recipient: { id: accountId }, timestamp: 1_700_000_000_000 };

function payload(...messaging: unknown[]) {
  return { object: "instagram", entry: [{ id: accountId, messaging }] };
}

describe("Instagram webhook parser", () => {
  it("normalizes inbound text, quick reply, referral and supported attachments", () => {
    const result = parseInstagramWebhook(
      payload({
        ...base,
        message: {
          mid: "m1",
          text: "hello",
          quick_reply: { payload: "ABC234" },
          referral: { ref: "DEF235" },
          attachments: [
            { type: "image", payload: { url: "https://cdn.example/image.jpg" } },
            { type: "video", payload: { url: "https://cdn.example/video.mp4" } },
            { type: "ephemeral", payload: {} },
          ],
        },
      }),
      accountId,
    );

    expect(result).toEqual({
      skipped: 0,
      events: [
        expect.objectContaining({
          type: "inbound_message",
          externalMessageId: "m1",
          senderId: "2000",
          text: "hello",
          attachmentUrls: ["https://cdn.example/image.jpg", "https://cdn.example/video.mp4"],
          imageAttachmentUrls: ["https://cdn.example/image.jpg"],
          quickReplyPayload: "ABC234",
          referralRef: "DEF235",
        }),
      ],
    });
  });

  it("normalizes every supported event shape", () => {
    const result = parseInstagramWebhook(
      payload(
        { ...base, message: { mid: "echo", text: "sent", is_echo: true } },
        { ...base, message: { mid: "deleted", is_deleted: true } },
        { ...base, read: { mid: "seen" } },
        { ...base, referral: { ref: "ABC234", type: "OPEN_THREAD" } },
        { ...base, reaction: { mid: "m", action: "react" } },
        { ...base, postback: { mid: "p", title: "Yes", payload: "YES" } },
        { ...base, message_edit: { mid: "edit", text: "new", num_edit: "1" } },
      ),
      accountId,
    );

    expect(result.events.map((event) => event.type)).toEqual([
      "echo",
      "deleted",
      "read",
      "referral",
      "window_signal",
      "window_signal",
      "message_edit",
    ]);
    expect(result.events[0]).toMatchObject({ recipientId: accountId, externalMessageId: "echo" });
    expect(result.skipped).toBe(0);
  });

  it("accepts timestamps in seconds", () => {
    const result = parseInstagramWebhook(
      payload({ ...base, timestamp: 1_700_000_000, read: { mid: "seen" } }),
      accountId,
    );
    expect(result.events[0]!.timestamp.toISOString()).toBe("2023-11-14T22:13:20.000Z");
  });

  it("skips unknown items and foreign account entries", () => {
    const result = parseInstagramWebhook(
      {
        object: "instagram",
        entry: [
          { id: accountId, messaging: [{ ...base, unknown: {} }] },
          { id: "9999", messaging: [{ ...base, read: { mid: "foreign" } }] },
        ],
      },
      accountId,
    );
    expect(result).toEqual({ events: [], skipped: 2 });
  });

  it("tolerates a malformed payload", () => {
    expect(parseInstagramWebhook({ object: "page" }, accountId)).toEqual({
      events: [],
      skipped: 1,
    });
  });
});
