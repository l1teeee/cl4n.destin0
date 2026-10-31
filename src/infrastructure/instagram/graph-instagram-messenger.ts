import { InstagramMessenger, MessengerError } from "@/application/messaging/instagram-messenger";

const TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const MAX_IMAGE_REDIRECTS = 3;
const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

interface MetaErrorBody {
  error?: { code?: unknown; error_subcode?: unknown; message?: unknown };
}

function numericField(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

async function responseBody(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function asMessengerError(response: Response, body: unknown): MessengerError {
  const error = body && typeof body === "object" ? (body as MetaErrorBody).error : undefined;
  return new MessengerError(
    typeof error?.message === "string" ? error.message : "Instagram request failed",
    {
      status: response.status,
      code: numericField(error?.code),
      subcode: numericField(error?.error_subcode),
    },
  );
}

function imageType(data: Buffer): string | null {
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) {
    return "image/jpeg";
  }
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from("89504e470d0a1a0a", "hex"))) {
    return "image/png";
  }
  if (
    data.length >= 12 &&
    data.toString("ascii", 0, 4) === "RIFF" &&
    data.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "image/webp";
  }
  const signature = data.toString("ascii", 0, 6);
  return signature === "GIF87a" || signature === "GIF89a" ? "image/gif" : null;
}

function isAllowedImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return (
      url.protocol === "https:" &&
      (hostname === "lookaside.fbsbx.com" ||
        hostname.endsWith(".cdninstagram.com") ||
        hostname.endsWith(".fbcdn.net"))
    );
  } catch {
    return false;
  }
}

export class GraphInstagramMessenger implements InstagramMessenger {
  constructor(
    private readonly options: { baseUrl: string; accountId: string; accessToken: string },
    private readonly request: typeof fetch = fetch,
  ) {}

  private async metaRequest(url: string, init: RequestInit): Promise<unknown> {
    let response: Response;
    try {
      response = await this.request(url, {
        ...init,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      throw new MessengerError(
        "Instagram network request failed",
        { status: null },
        { cause: error },
      );
    }
    const body = await responseBody(response);
    if (!response.ok) throw asMessengerError(response, body);
    return body;
  }

  private async send(recipientId: string, message: Record<string, unknown>) {
    const body = await this.metaRequest(
      `${this.options.baseUrl}/${this.options.accountId}/messages`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.options.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ recipient: { id: recipientId }, message }),
      },
    );
    const messageId =
      body &&
      typeof body === "object" &&
      typeof (body as { message_id?: unknown }).message_id === "string"
        ? (body as { message_id: string }).message_id
        : null;
    if (!messageId) {
      throw new MessengerError("Instagram response did not include a message id", { status: 200 });
    }
    return { messageId };
  }

  sendText(recipientId: string, text: string): Promise<{ messageId: string }> {
    return this.send(recipientId, { text });
  }

  sendImage(recipientId: string, url: string): Promise<{ messageId: string }> {
    return this.send(recipientId, {
      attachments: [{ type: "image", payload: { url } }],
    });
  }

  async fetchProfile(
    recipientId: string,
  ): Promise<{ username: string | null; name: string | null }> {
    const body = await this.metaRequest(
      `${this.options.baseUrl}/${recipientId}?fields=username,name`,
      { headers: { authorization: `Bearer ${this.options.accessToken}` } },
    );
    const record = body && typeof body === "object" ? (body as Record<string, unknown>) : {};
    return {
      username: typeof record.username === "string" ? record.username : null,
      name: typeof record.name === "string" ? record.name : null,
    };
  }

  async downloadImage(url: string): Promise<{ contentType: string; data: Buffer }> {
    let currentUrl = url;
    let response: Response | null = null;
    for (let redirects = 0; ; redirects += 1) {
      if (!isAllowedImageUrl(currentUrl)) {
        throw new MessengerError("Image URL is not an allowed Meta host", { status: 400 });
      }
      try {
        response = await this.request(currentUrl, {
          redirect: "manual",
          signal: AbortSignal.timeout(TIMEOUT_MS),
        });
      } catch (error) {
        throw new MessengerError("Image download failed", { status: null }, { cause: error });
      }
      if (!REDIRECT_STATUSES.has(response.status)) break;
      const location = response.headers.get("location");
      if (!location || redirects >= MAX_IMAGE_REDIRECTS) {
        throw new MessengerError("Image redirect limit exceeded", { status: 400 });
      }
      currentUrl = new URL(location, currentUrl).toString();
    }
    if (!response) throw new MessengerError("Image download failed", { status: null });
    if (!response.ok)
      throw new MessengerError("Image download failed", { status: response.status });
    if (!response.body)
      throw new MessengerError("Image response had no body", { status: response.status });

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_IMAGE_BYTES) {
      throw new MessengerError("Image exceeds size limit", { status: 413 });
    }

    const chunks: Buffer[] = [];
    let total = 0;
    const reader = response.body.getReader();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > MAX_IMAGE_BYTES) {
          await reader.cancel();
          throw new MessengerError("Image exceeds size limit", { status: 413 });
        }
        chunks.push(Buffer.from(value));
      }
    } catch (error) {
      if (error instanceof MessengerError) throw error;
      throw new MessengerError("Image download failed", { status: null }, { cause: error });
    }

    const data = Buffer.concat(chunks, total);
    const contentType = imageType(data);
    if (!contentType) {
      throw new MessengerError("Downloaded content is not a supported image", {
        status: 415,
      });
    }
    return { contentType, data };
  }
}
