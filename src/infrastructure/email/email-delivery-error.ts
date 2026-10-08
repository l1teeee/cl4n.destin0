export class EmailDeliveryError extends Error {
  readonly status: number | null;

  constructor(status: number | null, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmailDeliveryError";
    this.status = status;
  }
}
