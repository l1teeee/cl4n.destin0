import { beforeEach, describe, expect, it, vi } from "vitest";

const requireAdmin = vi.hoisted(() => vi.fn());
const retry = vi.hoisted(() => vi.fn());
const scheduleEmailDelivery = vi.hoisted(() => vi.fn());

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/infrastructure/auth/require-admin", () => ({ requireAdmin }));
vi.mock("@/infrastructure/email/outbox/schedule-email-delivery", () => ({
  scheduleEmailDelivery,
}));
vi.mock("@/infrastructure/email/outbox/postgres-email-outbox-repository", () => ({
  postgresEmailOutboxRepository: { retry },
}));

import { retryEmailAction } from "@/app/admin/(protected)/emails/actions";

const emailId = "6f1c3a52-8f0e-4f86-9d6e-0f4d3a9c1b27";

beforeEach(() => {
  requireAdmin.mockReset().mockResolvedValue({ authorized: true });
  retry.mockReset().mockResolvedValue(true);
  scheduleEmailDelivery.mockReset();
});

describe("retryEmailAction", () => {
  it("requeues a failed email and triggers delivery for any signed-in admin", async () => {
    await expect(retryEmailAction(emailId)).resolves.toMatchObject({ ok: true });

    expect(requireAdmin).toHaveBeenCalledWith("action");
    expect(retry).toHaveBeenCalledWith(emailId);
    expect(scheduleEmailDelivery).toHaveBeenCalledOnce();
  });

  it("rejects an unauthenticated caller before touching the outbox", async () => {
    requireAdmin.mockResolvedValue({ authorized: false, error: "UNAUTHORIZED" });

    await expect(retryEmailAction(emailId)).resolves.toMatchObject({ ok: false });

    expect(retry).not.toHaveBeenCalled();
    expect(scheduleEmailDelivery).not.toHaveBeenCalled();
  });

  it("rejects a malformed id", async () => {
    await expect(retryEmailAction("not-a-uuid")).resolves.toMatchObject({ ok: false });

    expect(retry).not.toHaveBeenCalled();
  });

  it("reports rows that are not in a failed state", async () => {
    retry.mockResolvedValue(false);

    await expect(retryEmailAction(emailId)).resolves.toMatchObject({ ok: false });

    expect(scheduleEmailDelivery).not.toHaveBeenCalled();
  });
});
