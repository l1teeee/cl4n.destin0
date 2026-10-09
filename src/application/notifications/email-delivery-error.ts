export class EmailDeliveryError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}

export class PermanentEmailCompositionError extends Error {
  readonly code: string;

  constructor(code: string) {
    super(code);
    this.name = "PermanentEmailCompositionError";
    this.code = code;
  }
}
