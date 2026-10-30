export const GUEST_STAGES = ["IN_REVIEW", "ON_LIST", "PAID"] as const;
export const RELEASE_REASONS = ["REJECTED", "CANCELLED"] as const;
export const REFUND_STATUSES = ["PENDING", "REFUNDED"] as const;

export type GuestStage = (typeof GUEST_STAGES)[number];
export type ReleaseReason = (typeof RELEASE_REASONS)[number];
export type RefundStatus = (typeof REFUND_STATUSES)[number];

export function canAccept(stage: GuestStage): boolean {
  return stage === "IN_REVIEW";
}

export function canVerifyPayment(stage: GuestStage): boolean {
  return stage === "ON_LIST";
}

export function canReject(stage: GuestStage): boolean {
  return stage === "IN_REVIEW";
}

export function canCancel(stage: GuestStage): boolean {
  return stage === "ON_LIST" || stage === "PAID";
}

export function releaseReasonFor(stage: GuestStage): ReleaseReason {
  return stage === "IN_REVIEW" ? "REJECTED" : "CANCELLED";
}

export function refundStatusOnRelease(stage: GuestStage): RefundStatus | null {
  return stage === "PAID" ? "PENDING" : null;
}
