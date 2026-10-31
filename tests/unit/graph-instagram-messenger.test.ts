import { describe, expect, it, vi } from "vitest";

import { MessengerError } from "@/application/messaging/instagram-messenger";
import { GraphInstagramMessenger } from "@/infrastructure/instagram/graph-instagram-messenger";

function messenger(request: ReturnType<typeof vi.fn>) {
  return new GraphInstagramMessenger(
    { baseUrl: "https://graph.instagram.com/v26.0", accountId: "123", accessToken: "token" },
    request as typeof fetch,
  );
}

describe("Graph Instagram messenger", () => {
  it("sends the exact text request", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ recipient_id: "456", message_id: "mid-text" }));
    await expect(messenger(request).sendText("456", "hola")).resolves.toEqual({
      messageId: "mid-text",
    });
    expect(request).toHaveBeenCalledWith(
      "https://graph.instagram.com/v26.0/123/messages",
      expect.objectContaining({
        method: "POST",
        headers: {
          authorization: "Bearer token",
          "content-type": "application/json",
        },
        body: JSON.stringify({ recipient: { id: "456" }, message: { text: "hola" } }),
      }),
    );
  });

  it("uses the researched array image body", async () => {
    const request = vi.fn().mockResolvedValue(Response.json({ message_id: "mid-image" }));
    await messenger(request).sendImage("456", "https://cdn.example/image.jpg");
    expect(JSON.parse(request.mock.calls[0]![1].body)).toEqual({
      recipient: { id: "456" },
      message: {
        attachments: [{ type: "image", payload: { url: "https://cdn.example/image.jpg" } }],
      },
    });
  });

  it("fetches a profile with the bearer token", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(Response.json({ username: "ana.lopez", name: "Ana López" }));
    await expect(messenger(request).fetchProfile("456")).resolves.toEqual({
      username: "ana.lopez",
      name: "Ana López",
    });
    expect(request.mock.calls[0]![0]).toBe(
      "https://graph.instagram.com/v26.0/456?fields=username,name",
    );
  });

  it("parses Meta error fields", async () => {
    const request = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { error: { code: 10, error_subcode: 2534022, message: "outside window" } },
          { status: 400 },
        ),
      );
    const error = await messenger(request)
      .sendText("456", "hola")
      .catch((value) => value);
    expect(error).toBeInstanceOf(MessengerError);
    expect(error).toMatchObject({ status: 400, code: 10, subcode: 2534022 });
  });

  it("checks downloaded image magic bytes", async () => {
    const png = Buffer.concat([Buffer.from("89504e470d0a1a0a", "hex"), Buffer.from("data")]);
    const request = vi.fn().mockResolvedValue(new Response(png));
    await expect(messenger(request).downloadImage("https://cdn.example/image")).resolves.toEqual({
      contentType: "image/png",
      data: png,
    });
    expect(request.mock.calls[0]![1]).toMatchObject({ redirect: "follow" });
  });

  it("rejects unsupported content and oversized declared images", async () => {
    const unsupported = vi.fn().mockResolvedValue(new Response(Buffer.from("not image")));
    await expect(
      messenger(unsupported).downloadImage("https://cdn.example/file"),
    ).rejects.toBeInstanceOf(MessengerError);

    const oversized = vi.fn().mockResolvedValue(
      new Response(Buffer.from("x"), {
        headers: { "content-length": String(8 * 1024 * 1024 + 1) },
      }),
    );
    await expect(
      messenger(oversized).downloadImage("https://cdn.example/large"),
    ).rejects.toBeInstanceOf(MessengerError);
  });
});
