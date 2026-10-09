// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { EventForm } from "@/ui/admin/event-form";
import { DatePicker } from "@/ui/primitives/date-picker";
import { DateTimePicker } from "@/ui/primitives/date-time-picker";
import { FieldHint } from "@/ui/primitives/field-hint";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/ui/primitives/select";
import { Switch } from "@/ui/primitives/switch";
import { TimePicker } from "@/ui/primitives/time-picker";

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
  global.PointerEvent ??= class PointerEvent extends MouseEvent {
    pointerType: string;
    constructor(type: string, init: MouseEventInit & { pointerType?: string } = {}) {
      super(type, init);
      this.pointerType = init.pointerType ?? "";
    }
  } as typeof PointerEvent;
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

function hiddenInput(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement>(`input[type="hidden"][name="${name}"]`);
}

describe("admin date and time controls", () => {
  it("renders and updates DatePicker values", () => {
    const { container } = render(<DatePicker name="eventDate" defaultValue="2026-10-09" />);

    expect(screen.getByRole("button", { name: "9 oct 2026" })).toBeDefined();
    expect(hiddenInput(container, "eventDate")?.value).toBe("2026-10-09");

    fireEvent.click(screen.getByRole("button", { name: "9 oct 2026" }));
    fireEvent.click(screen.getByRole("button", { name: /15 de octubre de 2026/i }));

    expect(hiddenInput(container, "eventDate")?.value).toBe("2026-10-15");
    expect(screen.getByRole("button", { name: "15 oct 2026" })).toBeDefined();
  });

  it("renders and updates TimePicker values", () => {
    const { container } = render(<TimePicker name="eventTime" defaultValue="20:00" />);

    expect(screen.getByRole("button", { name: "20:00" })).toBeDefined();
    expect(hiddenInput(container, "eventTime")?.value).toBe("20:00");

    fireEvent.click(screen.getByRole("button", { name: "20:00" }));
    fireEvent.click(screen.getAllByRole("button", { name: "21" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "30" }));

    expect(hiddenInput(container, "eventTime")?.value).toBe("21:30");
    expect(screen.getByRole("button", { name: "21:30" })).toBeDefined();
  });

  it("centers the selected time item by scrolling only its column", () => {
    const scrollIntoView = vi.mocked(HTMLElement.prototype.scrollIntoView);
    scrollIntoView.mockClear();
    const offsets = { offsetTop: 100, clientHeight: 200, offsetHeight: 32 };
    for (const [key, value] of Object.entries(offsets)) {
      Object.defineProperty(HTMLElement.prototype, key, { configurable: true, value });
    }

    try {
      render(<TimePicker name="eventTime" defaultValue="20:00" />);
      fireEvent.click(screen.getByRole("button", { name: "20:00" }));

      const selectedItem = document.querySelector("[data-selected=true]")!;
      expect(selectedItem.parentElement!.scrollTop).toBe(16);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      for (const key of Object.keys(offsets)) {
        delete (HTMLElement.prototype as unknown as Record<string, unknown>)[key];
      }
    }
  });

  it("shows a missing time placeholder when only the date is chosen", () => {
    render(<DateTimePicker name="opensAt" defaultValue="2026-10-09" />);

    const trigger = screen.getByRole("button", { name: "9 oct 2026 · --:--" });
    expect(trigger).toBeDefined();
    expect(screen.getByText("--:--").className).toContain("text-muted-foreground");
  });

  it("formats DateTimePicker and posts only complete values", () => {
    const first = render(<DateTimePicker name="opensAt" defaultValue="2026-10-09T20:00" />);

    expect(screen.getByRole("button", { name: "9 oct 2026 · 20:00" })).toBeDefined();
    expect(hiddenInput(first.container, "opensAt")?.value).toBe("2026-10-09T20:00");
    first.unmount();

    const second = render(<DateTimePicker name="closesAt" />);
    fireEvent.click(screen.getByRole("button", { name: "Selecciona fecha y hora" }));
    fireEvent.click(screen.getByRole("button", { name: /viernes, 9 de octubre/i }));

    expect(hiddenInput(second.container, "closesAt")?.value).toBe("");
    expect(screen.getByRole("button", { name: /9 oct \d{4}/i })).toBeDefined();

    fireEvent.click(screen.getAllByRole("button", { name: "20" })[0]!);
    fireEvent.click(screen.getByRole("button", { name: "30" }));

    expect(hiddenInput(second.container, "closesAt")?.value).toMatch(/^\d{4}-10-09T20:30$/);
  });
});

describe("admin form-compatible controls", () => {
  it("posts on only while Switch is checked", () => {
    const { container } = render(
      <form>
        <Switch name="autoCloseOnFull" />
      </form>,
    );
    const form = container.querySelector("form")!;
    const control = screen.getByRole("switch");

    expect(new FormData(form).has("autoCloseOnFull")).toBe(false);
    fireEvent.click(control);
    expect(new FormData(form).get("autoCloseOnFull")).toBe("on");
    fireEvent.click(control);
    expect(new FormData(form).has("autoCloseOnFull")).toBe(false);
  });

  it("posts the selected Select value", () => {
    const { container } = render(
      <form>
        <Select name="status" defaultValue="DRAFT">
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="DRAFT">Borrador</SelectItem>
            <SelectItem value="SCHEDULED">Programada</SelectItem>
          </SelectContent>
        </Select>
      </form>,
    );
    const form = container.querySelector("form")!;

    expect(new FormData(form).get("status")).toBe("DRAFT");
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("option", { name: "Programada" }));

    expect(new FormData(form).get("status")).toBe("SCHEDULED");
  });

  it("keeps the EventForm server field contract", () => {
    const { container } = render(
      <EventForm action={vi.fn(async () => ({ ok: true, message: "" }))} mode="create" />,
    );

    for (const name of [
      "eventDate",
      "eventTime",
      "opensAt",
      "closesAt",
      "status",
      "autoCloseOnFull",
    ]) {
      expect(container.querySelector(`[name="${name}"]`)).not.toBeNull();
    }
    expect(screen.getByRole("button", { name: "Qué es el slug" })).toBeDefined();
  });
});

describe("FieldHint", () => {
  function mouse(element: Element, type: "pointerover" | "pointerout") {
    fireEvent(
      element,
      new PointerEvent(type, { bubbles: true, pointerType: "mouse" } as PointerEventInit),
    );
  }

  it("opens on hover without stealing focus from the focused input", () => {
    render(
      <div>
        <input aria-label="slug" />
        <FieldHint label="Qué es">Ayuda</FieldHint>
      </div>,
    );
    const input = screen.getByLabelText("slug");
    input.focus();

    mouse(screen.getByRole("button", { name: "Qué es" }), "pointerover");

    expect(screen.getByText("Ayuda")).toBeDefined();
    expect(document.activeElement).toBe(input);
  });

  it("keeps the hint open after click and pointer leave once opened by hover", () => {
    vi.useFakeTimers();
    try {
      render(<FieldHint label="Qué es">Ayuda</FieldHint>);
      const trigger = screen.getByRole("button", { name: "Qué es" });

      mouse(trigger, "pointerover");
      fireEvent.click(trigger);
      expect(screen.queryByText("Ayuda")).not.toBeNull();

      mouse(trigger, "pointerout");
      act(() => {
        vi.advanceTimersByTime(500);
      });
      expect(screen.queryByText("Ayuda")).not.toBeNull();

      fireEvent.click(trigger);
      expect(screen.queryByText("Ayuda")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("opens on a keyboard-style click after a hover cycle closed the hint", () => {
    vi.useFakeTimers();
    try {
      render(<FieldHint label="Qué es">Ayuda</FieldHint>);
      const trigger = screen.getByRole("button", { name: "Qué es" });

      mouse(trigger, "pointerover");
      mouse(trigger, "pointerout");
      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(screen.queryByText("Ayuda")).toBeNull();

      fireEvent.click(trigger);
      expect(screen.queryByText("Ayuda")).not.toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });
});
