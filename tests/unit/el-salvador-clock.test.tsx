// @vitest-environment jsdom

import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatElSalvadorClock } from "@/infrastructure/time/el-salvador-time";
import { ElSalvadorClock } from "@/ui/admin/el-salvador-clock";

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("formatElSalvadorClock", () => {
  it.each([
    ["2030-11-01T21:42:00.000Z", "3:42 p. m."],
    ["2030-11-01T06:05:00.000Z", "12:05 a. m."],
    ["2030-11-01T18:00:00.000Z", "12:00 p. m."],
  ])("formats %s as %s in El Salvador", (value, expected) => {
    expect(formatElSalvadorClock(new Date(value))).toBe(expected);
  });
});

describe("ElSalvadorClock", () => {
  it("shows the El Salvador time and refreshes it every 30 seconds", () => {
    vi.setSystemTime(new Date("2030-11-01T21:42:10.000Z"));
    render(<ElSalvadorClock />);

    expect(screen.getByText("Hora actual (El Salvador): 3:42 p. m.")).toBeDefined();

    act(() => {
      vi.setSystemTime(new Date("2030-11-01T21:43:05.000Z"));
      vi.advanceTimersByTime(30_000);
    });

    expect(screen.getByText("Hora actual (El Salvador): 3:43 p. m.")).toBeDefined();
  });
});
