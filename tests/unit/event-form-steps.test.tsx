// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
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

const validValues = {
  internalName: "Cena de noviembre",
  slug: "cena-noviembre",
  eventDate: "2026-11-20",
  eventTime: "19:30",
  opensAt: "2026-11-01T08:00",
  closesAt: "2026-11-19T20:00",
  capacity: 20,
  maxPartySize: 2,
  autoCloseOnFull: true,
  waitlistCapacity: 5,
  status: "DRAFT",
  locationName: null,
  locationAddress: null,
  locationMapsUrl: null,
  locationNotes: null,
  locationStatus: "PENDING",
} satisfies EventFormValues;

type EventAction = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

function renderCreate(action?: EventAction, values: EventFormValues | undefined = validValues) {
  const eventAction =
    action ?? vi.fn(async (): Promise<AdminActionState> => ({ ok: true, message: "" }));
  return render(<EventForm action={eventAction} mode="create" values={values} />);
}

describe("create event form steps", () => {
  it("starts on step one with location fields hidden", () => {
    renderCreate();

    expect(screen.getByText("Paso 1 de 2")).toBeDefined();
    expect(screen.getByRole("button", { name: "Siguiente" })).toBeDefined();
    expect(screen.getByLabelText("Nombre del lugar").closest("section")?.hidden).toBe(true);
    expect(document.querySelector('[aria-current="step"]')?.textContent).toContain("Experiencia");
  });

  it("stays on step one, shows errors, and focuses the first invalid field", async () => {
    render(
      <EventForm
        action={vi.fn(async (): Promise<AdminActionState> => ({ ok: true, message: "" }))}
        mode="create"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(screen.getByText("Paso 1 de 2")).toBeDefined();
    expect(screen.getByText("Revisa los campos marcados.")).toBeDefined();
    expect(screen.getByText("El nombre interno es obligatorio.")).toBeDefined();
    const internalName = document.querySelector('[name="internalName"]');
    expect(internalName?.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(internalName));
  });

  it("blocks a maximum party size above capacity", () => {
    renderCreate(undefined, { ...validValues, capacity: 2, maxPartySize: 3 });

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    expect(
      screen.getByText("El tamaño máximo del grupo no puede superar la capacidad."),
    ).toBeDefined();
    expect(document.querySelector('[name="maxPartySize"]')?.getAttribute("aria-invalid")).toBe(
      "true",
    );
  });

  it("moves forward and back without losing values", () => {
    renderCreate();
    const internalName = screen.getByLabelText("Nombre interno") as HTMLInputElement;
    fireEvent.change(internalName, { target: { value: "Cena editada antes de avanzar" } });

    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    expect(screen.getByText("Paso 2 de 2")).toBeDefined();
    expect(screen.getByLabelText("Nombre del lugar").closest("section")?.hidden).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: "Atrás" }));
    expect(screen.getByText("Paso 1 de 2")).toBeDefined();
    expect(internalName.value).toBe("Cena editada antes de avanzar");
  });

  it("treats Enter on step one as Siguiente without calling the action", () => {
    const action = vi.fn(async (): Promise<AdminActionState> => ({ ok: true, message: "" }));
    renderCreate(action);
    const internalName = screen.getByLabelText("Nombre interno") as HTMLInputElement;

    fireEvent.submit(internalName.form!);

    expect(screen.getByText("Paso 2 de 2")).toBeDefined();
    expect(action).not.toHaveBeenCalled();
  });

  it("submits both steps once from step two", async () => {
    const action = vi.fn<EventAction>(async (state, formData) => {
      void state;
      void formData;
      return { ok: true, message: "" };
    });
    renderCreate(action);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));
    fireEvent.change(screen.getByLabelText("Nombre del lugar"), {
      target: { value: "Casa Clandestina" },
    });

    fireEvent.click(screen.getByRole("button", { name: "Crear experiencia" }));

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    const submitted = action.mock.calls[0]![1];
    expect(submitted).toBeInstanceOf(FormData);
    expect(submitted.get("internalName")).toBe("Cena de noviembre");
    expect(submitted.get("locationName")).toBe("Casa Clandestina");
    expect(submitted.get("autoCloseOnFull")).toBe("on");
  });

  it("returns to step one for a server error on a step-one field", async () => {
    const action = vi.fn(async (): Promise<AdminActionState> => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { slug: "Ese slug ya está en uso." },
    }));
    renderCreate(action);
    fireEvent.click(screen.getByRole("button", { name: "Siguiente" }));

    fireEvent.click(screen.getByRole("button", { name: "Crear experiencia" }));

    expect(await screen.findByText("Ese slug ya está en uso.")).toBeDefined();
    expect(screen.getByText("Paso 1 de 2")).toBeDefined();
    const slug = screen.getByLabelText("Slug");
    expect(slug.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(slug));
  });
});

describe("edit event form", () => {
  it("renders all fields without wizard controls", () => {
    render(
      <EventForm
        action={vi.fn(async () => ({ ok: true, message: "" }))}
        mode="edit"
        values={{ ...validValues, locationRevision: 0 }}
      />,
    );

    expect(screen.getByLabelText("Nombre interno")).toBeDefined();
    expect(screen.getByLabelText("Nombre del lugar")).toBeDefined();
    expect(screen.queryByText(/Paso \d de 2/)).toBeNull();
    expect(screen.queryByRole("button", { name: "Siguiente" })).toBeNull();
    expect(screen.getByRole("button", { name: "Guardar cambios" })).toBeDefined();
  });
});
