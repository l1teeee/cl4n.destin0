// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EventForm, type EventFormValues } from "@/ui/admin/event-form";

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

const mapsUrl = "https://www.google.com/maps/place/Casa/@13.69,-89.21,17z";
const values = {
  internalName: "Cena guardada",
  slug: "cena-guardada",
  eventDate: "2026-10-09",
  eventTime: "20:00",
  opensAt: "2026-10-01T08:00",
  closesAt: "2026-10-08T20:00",
  maxPartySize: 2,
  autoCloseOnFull: false,
  waitlistCapacity: 5,
  locationName: null,
  locationAddress: "Calle 1",
  locationMapsUrl: mapsUrl,
  locationNotes: null,
  locationStatus: "CONFIRMED",
  locationRevision: 0,
} satisfies EventFormValues;

const warning = /Cambiaste la dirección/;
const action = vi.fn(async () => ({ ok: true, message: "" }));

function changeField(container: HTMLElement, name: string, value: string) {
  fireEvent.change(container.querySelector(`[name="${name}"]`)!, { target: { value } });
}

describe("maps link warning in the event form", () => {
  it("is hidden until the address changes", () => {
    const { container } = render(<EventForm action={action} mode="edit" values={values} />);
    expect(screen.queryByText(warning)).toBeNull();
    expect(container.querySelector('[name="keepMapsUrl"]')).toBeNull();
  });

  it("shows the warning and the keep checkbox after an address change", () => {
    const { container } = render(<EventForm action={action} mode="edit" values={values} />);
    changeField(container, "locationAddress", "Calle 2");
    expect(screen.getByText(warning)).toBeDefined();
    expect(screen.getByLabelText("Mantener el enlace de Google Maps actual")).toBeDefined();
    expect(container.querySelector<HTMLInputElement>('[name="keepMapsUrl"]')?.checked).toBe(false);
  });

  it("hides them again when the Maps link is replaced", () => {
    const { container } = render(<EventForm action={action} mode="edit" values={values} />);
    changeField(container, "locationAddress", "Calle 2");
    changeField(
      container,
      "locationMapsUrl",
      "https://www.google.com/maps/place/Otra/@13.7,-89.2,17z",
    );
    expect(screen.queryByText(warning)).toBeNull();
  });

  it("never shows in create mode", () => {
    const { container } = render(<EventForm action={action} mode="create" />);
    changeField(container, "locationAddress", "Calle 2");
    expect(screen.queryByText(warning)).toBeNull();
  });
});
