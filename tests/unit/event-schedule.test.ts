import { describe, expect, it, vi } from "vitest";

import { resolveCreateSchedule, resolveUpdateSchedule } from "@/application/events/event-schedule";
import type { EventRepository } from "@/application/events/event-repository";
import type { AdminEventDetail } from "@/application/events/types";
import {
  OPENING_MARGIN_MS,
  roundUpToNextMinute,
  scheduleMessages,
  validateEventSchedule,
  type EventScheduleInput,
} from "@/domain/event/event-schedule";

const now = new Date("2030-11-01T18:00:00.000Z");
const startsAt = new Date("2030-11-10T02:00:00.000Z");
const closesAt = new Date("2030-11-09T20:00:00.000Z");

function input(overrides: Partial<EventScheduleInput> = {}): EventScheduleInput {
  return {
    startsAt,
    opensAt: new Date(now.getTime() + 60 * 60 * 1000),
    closesAt,
    now,
    previousStartsAt: null,
    previousOpensAt: null,
    eventIsOpenOrClosed: false,
    ...overrides,
  };
}

describe("validateEventSchedule", () => {
  it("accepts a coherent future schedule", () => {
    expect(validateEventSchedule(input())).toEqual({});
  });

  it("requires the dinner to be after now", () => {
    expect(validateEventSchedule(input({ startsAt: now }))).toMatchObject({
      startsAt: scheduleMessages.startsAtNotFuture,
    });
    expect(
      validateEventSchedule(input({ startsAt: new Date(now.getTime() + 1), closesAt: now })),
    ).not.toHaveProperty("startsAt");
  });

  it("accepts an opening exactly two minutes in the past and rejects one millisecond earlier", () => {
    const boundary = new Date(now.getTime() - OPENING_MARGIN_MS);

    expect(validateEventSchedule(input({ opensAt: boundary }))).toEqual({});
    expect(validateEventSchedule(input({ opensAt: new Date(boundary.getTime() - 1) }))).toEqual({
      opensAt: scheduleMessages.opensAtInPast,
    });
  });

  it("requires the closing to be after the opening", () => {
    const opensAt = new Date(now.getTime() + 60 * 60 * 1000);

    expect(validateEventSchedule(input({ opensAt, closesAt: opensAt }))).toEqual({
      closesAt: scheduleMessages.closesAtNotAfterOpening,
    });
    expect(
      validateEventSchedule(input({ opensAt, closesAt: new Date(opensAt.getTime() + 1) })),
    ).toEqual({});
  });

  it("requires the closing to be at or before the dinner", () => {
    expect(validateEventSchedule(input({ closesAt: startsAt }))).toEqual({});
    expect(validateEventSchedule(input({ closesAt: new Date(startsAt.getTime() + 1) }))).toEqual({
      closesAt: scheduleMessages.closesAtNotBeforeDinner,
    });
  });

  describe("when editing", () => {
    const stalePreviousOpensAt = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    it("does not require a future dinner while the dinner time is unchanged", () => {
      const pastDinner = new Date(now.getTime() - 24 * 60 * 60 * 1000);
      const opensAt = new Date(pastDinner.getTime() - 3 * 24 * 60 * 60 * 1000);
      const closesAt = new Date(pastDinner.getTime() - 60 * 60 * 1000);

      expect(
        validateEventSchedule(
          input({
            startsAt: pastDinner,
            opensAt,
            closesAt,
            previousStartsAt: pastDinner,
            previousOpensAt: opensAt,
            eventIsOpenOrClosed: true,
          }),
        ),
      ).toEqual({});
    });

    it("requires a future dinner once the dinner time changes", () => {
      const pastDinner = new Date(now.getTime() - 24 * 60 * 60 * 1000);

      expect(
        validateEventSchedule(
          input({
            startsAt: new Date(pastDinner.getTime() + 60_000),
            closesAt: pastDinner,
            previousStartsAt: pastDinner,
          }),
        ),
      ).toMatchObject({ startsAt: scheduleMessages.startsAtNotFuture });
    });

    it("does not check an unchanged opening", () => {
      expect(
        validateEventSchedule(
          input({ opensAt: stalePreviousOpensAt, previousOpensAt: stalePreviousOpensAt }),
        ),
      ).toEqual({});
    });

    it("checks a changed opening while the event has not opened", () => {
      expect(
        validateEventSchedule(
          input({
            opensAt: new Date(now.getTime() - 60 * 60 * 1000),
            previousOpensAt: stalePreviousOpensAt,
          }),
        ),
      ).toEqual({ opensAt: scheduleMessages.opensAtInPast });
    });

    it("does not check a changed opening once the event opened or closed", () => {
      expect(
        validateEventSchedule(
          input({
            opensAt: new Date(now.getTime() - 60 * 60 * 1000),
            previousOpensAt: stalePreviousOpensAt,
            eventIsOpenOrClosed: true,
          }),
        ),
      ).toEqual({});
    });
  });
});

describe("roundUpToNextMinute", () => {
  it.each([
    ["2030-11-01T18:00:00.001Z", "2030-11-01T18:01:00.000Z"],
    ["2030-11-01T18:00:30.000Z", "2030-11-01T18:01:00.000Z"],
    ["2030-11-01T18:00:00.000Z", "2030-11-01T18:00:00.000Z"],
  ])("rounds %s to %s", (value, expected) => {
    expect(roundUpToNextMinute(new Date(value)).toISOString()).toBe(expected);
  });
});

function detail(overrides: Partial<AdminEventDetail>): AdminEventDetail {
  return {
    startsAt,
    opensAt: new Date(now.getTime() + 60 * 60 * 1000),
    phase: "DRAFT",
    ...overrides,
  } as AdminEventDetail;
}

function repositoryAt(databaseTime: Date, current: AdminEventDetail | null = null) {
  return {
    databaseTime: vi.fn().mockResolvedValue(databaseTime),
    getAdminEvent: vi.fn().mockResolvedValue({ databaseTime, value: current }),
  } as unknown as EventRepository;
}

const request = {
  startsAt,
  opensAt: new Date(now.getTime() + 60 * 60 * 1000),
  closesAt,
  openNow: false,
};

describe("resolveCreateSchedule", () => {
  it("judges the schedule against the database time", async () => {
    const lateRepository = repositoryAt(new Date(request.opensAt.getTime() + 10 * 60 * 1000));

    await expect(resolveCreateSchedule(lateRepository, request)).resolves.toEqual({
      ok: false,
      errors: { opensAt: scheduleMessages.opensAtInPast },
    });
    await expect(resolveCreateSchedule(repositoryAt(now), request)).resolves.toEqual({
      ok: true,
      opensAt: request.opensAt,
    });
  });

  it("opens at the database time and ignores the typed opening when asked to open now", async () => {
    const stale = { ...request, opensAt: new Date("2020-01-01T00:00:00.000Z"), openNow: true };

    await expect(resolveCreateSchedule(repositoryAt(now), stale)).resolves.toEqual({
      ok: true,
      opensAt: now,
    });
  });

  it("still validates the closing after opening now", async () => {
    const result = await resolveCreateSchedule(repositoryAt(now), {
      ...request,
      closesAt: new Date(now.getTime() - 1),
      openNow: true,
    });

    expect(result).toEqual({
      ok: false,
      errors: { closesAt: scheduleMessages.closesAtNotAfterOpening },
    });
  });
});

describe("resolveUpdateSchedule", () => {
  it("lets a closed event past its dinner be edited when the dinner time is unchanged", async () => {
    const pastDinner = new Date(now.getTime() - 24 * 60 * 60 * 1000);
    const pastOpensAt = new Date(pastDinner.getTime() - 3 * 24 * 60 * 60 * 1000);
    const pastClosesAt = new Date(pastDinner.getTime() - 60 * 60 * 1000);
    const repository = repositoryAt(
      now,
      detail({ phase: "CLOSED", startsAt: pastDinner, opensAt: pastOpensAt }),
    );
    const unchanged = {
      startsAt: pastDinner,
      opensAt: pastOpensAt,
      closesAt: pastClosesAt,
      openNow: false,
    };

    await expect(resolveUpdateSchedule(repository, "event-id", unchanged)).resolves.toEqual({
      ok: true,
      opensAt: pastOpensAt,
    });
    await expect(
      resolveUpdateSchedule(repository, "event-id", {
        ...unchanged,
        startsAt: new Date(pastDinner.getTime() + 60_000),
        closesAt: pastDinner,
      }),
    ).resolves.toEqual({
      ok: false,
      errors: { startsAt: scheduleMessages.startsAtNotFuture },
    });
  });

  it("skips the opening check when it did not change", async () => {
    const previousOpensAt = new Date(now.getTime() - 3 * 60 * 60 * 1000);
    const repository = repositoryAt(now, detail({ opensAt: previousOpensAt }));

    await expect(
      resolveUpdateSchedule(repository, "event-id", { ...request, opensAt: previousOpensAt }),
    ).resolves.toEqual({ ok: true, opensAt: previousOpensAt });
  });

  it("checks a changed opening while the event has not opened", async () => {
    const repository = repositoryAt(now, detail({ phase: "SCHEDULED" }));

    await expect(
      resolveUpdateSchedule(repository, "event-id", {
        ...request,
        opensAt: new Date(now.getTime() - 60 * 60 * 1000),
      }),
    ).resolves.toEqual({ ok: false, errors: { opensAt: scheduleMessages.opensAtInPast } });
  });

  it("does not check a changed opening once the event is open", async () => {
    const repository = repositoryAt(now, detail({ phase: "OPEN" }));
    const earlier = new Date(now.getTime() - 60 * 60 * 1000);

    await expect(
      resolveUpdateSchedule(repository, "event-id", { ...request, opensAt: earlier }),
    ).resolves.toEqual({ ok: true, opensAt: earlier });
  });

  it("keeps the typed opening instead of opening now once the event is open", async () => {
    const repository = repositoryAt(now, detail({ phase: "OPEN" }));
    const earlier = new Date(now.getTime() - 60 * 60 * 1000);

    await expect(
      resolveUpdateSchedule(repository, "event-id", {
        ...request,
        opensAt: earlier,
        openNow: true,
      }),
    ).resolves.toEqual({ ok: true, opensAt: earlier });
  });

  it("opens now on an event that has not opened", async () => {
    const repository = repositoryAt(now, detail({ phase: "DRAFT" }));

    await expect(
      resolveUpdateSchedule(repository, "event-id", { ...request, openNow: true }),
    ).resolves.toEqual({ ok: true, opensAt: now });
  });

  it("leaves a missing event to the update itself", async () => {
    await expect(
      resolveUpdateSchedule(repositoryAt(now, null), "event-id", request),
    ).resolves.toEqual({ ok: true, opensAt: request.opensAt });
  });
});
