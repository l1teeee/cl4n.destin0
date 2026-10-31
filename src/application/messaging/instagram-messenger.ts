export class MessengerError extends Error {
  readonly status: number | null;
  readonly code: number | null;
  readonly subcode: number | null;

  constructor(
    message: string,
    fields: { status: number | null; code?: number | null; subcode?: number | null },
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "MessengerError";
    this.status = fields.status;
    this.code = fields.code ?? null;
    this.subcode = fields.subcode ?? null;
  }
}

export interface InstagramMessenger {
  sendText(recipientId: string, text: string): Promise<{ messageId: string }>;
  sendImage(recipientId: string, url: string): Promise<{ messageId: string }>;
  fetchProfile(recipientId: string): Promise<{ username: string | null; name: string | null }>;
  downloadImage(url: string): Promise<{ contentType: string; data: Buffer }>;
}
