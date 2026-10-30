import { describe, expect, it } from "vitest";

import {
  canAccept,
  canCancel,
  canReject,
  canVerifyPayment,
  GUEST_STAGES,
  REFUND_STATUSES,
  refundStatusOnRelease,
  RELEASE_REASONS,
  releaseReasonFor,
} from "@/domain/reservation/guest-stage";

describe("guest stage rules", () => {
  it("exports the stored values", () => {
    expect(GUEST_STAGES).toEqual(["IN_REVIEW", "ON_LIST", "PAID"]);
    expect(RELEASE_REASONS).toEqual(["REJECTED", "CANCELLED"]);
    expect(REFUND_STATUSES).toEqual(["PENDING", "REFUNDED"]);
  });

  it("allows only the defined stage transitions", () => {
    expect(GUEST_STAGES.map(canAccept)).toEqual([true, false, false]);
    expect(GUEST_STAGES.map(canVerifyPayment)).toEqual([false, true, false]);
    expect(GUEST_STAGES.map(canReject)).toEqual([true, false, false]);
    expect(GUEST_STAGES.map(canCancel)).toEqual([false, true, true]);
  });

  it("derives release and refund state from the current stage", () => {
    expect(GUEST_STAGES.map(releaseReasonFor)).toEqual(["REJECTED", "CANCELLED", "CANCELLED"]);
    expect(GUEST_STAGES.map(refundStatusOnRelease)).toEqual([null, null, "PENDING"]);
  });
});
