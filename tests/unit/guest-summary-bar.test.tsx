// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuestSummaryBar } from "@/ui/admin/guests/guest-summary-bar";

afterEach(cleanup);

describe("GuestSummaryBar", () => {
  it("renders every item as one line separated by a middle dot", () => {
    const { container } = render(
      <GuestSummaryBar
        items={[
          { label: "Capacidad", value: "20" },
          { label: "Reservados", value: "12" },
          { label: "Disponibles", value: "8" },
        ]}
      />,
    );

    expect(container.textContent).toBe("Capacidad 20 · Reservados 12 · Disponibles 8");
    expect(container.querySelectorAll("p")).toHaveLength(1);
  });

  it("adds no separator around a single item", () => {
    const { container } = render(<GuestSummaryBar items={[{ label: "Cola", value: "2 / 5" }]} />);

    expect(container.textContent).toBe("Cola 2 / 5");
  });

  it("uses the muted admin style", () => {
    const { container } = render(<GuestSummaryBar items={[{ label: "Cola", value: "0" }]} />);

    expect(container.querySelector("p")?.className).toContain("admin-muted");
  });
});
