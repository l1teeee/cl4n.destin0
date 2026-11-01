import { randomUUID } from "node:crypto";

import { InstagramMessenger, MessengerError } from "@/application/messaging/instagram-messenger";
import { log } from "@/infrastructure/observability/logger";

export class LogInstagramMessenger implements InstagramMessenger {
  async sendText(_recipientId: string, text: string): Promise<{ messageId: string }> {
    log("info", "instagram_message_logged", { kind: "text", bytes: Buffer.byteLength(text) });
    return { messageId: `log-${randomUUID()}` };
  }

  async sendImage(_recipientId: string, url: string): Promise<{ messageId: string }> {
    log("info", "instagram_message_logged", { kind: "image", bytes: Buffer.byteLength(url) });
    return { messageId: `log-${randomUUID()}` };
  }

  async fetchProfile(): Promise<{ username: null; name: null }> {
    return { username: null, name: null };
  }

  async downloadImage(): Promise<never> {
    throw new MessengerError("Image downloads are unavailable in log mode", { status: null });
  }
}
