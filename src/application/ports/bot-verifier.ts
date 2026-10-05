export type BotVerificationResult =
  | { ok: true }
  | {
      ok: false;
      reason: "TOKEN_EXPIRED_OR_SPENT" | "INVALID" | "MISMATCH" | "UNAVAILABLE";
    };

export interface BotVerificationRequest {
  token: string;
  remoteIp: string | null;
  idempotencyKey: string;
}

export interface BotVerifier {
  verify(request: BotVerificationRequest): Promise<BotVerificationResult>;
}
