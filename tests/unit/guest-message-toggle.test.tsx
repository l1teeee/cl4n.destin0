// @vitest-environment jsdom

import type { ReactElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { GuestMessageToggle } from "@/ui/admin/guests/guest-message-toggle";

afterEach(cleanup);

const preview = "Hola Ana.\nTu lugar quedó en la lista.\n\nGracias.";

function renderInForm(toggle: ReactElement) {
  const view = render(<form>{toggle}</form>);
  return { ...view, form: view.container.querySelector("form")! };
}

describe("GuestMessageToggle checkbox", () => {
  it("is labelled and checked by default", () => {
    render(<GuestMessageToggle />);

    const checkbox = screen.getByRole("checkbox", {
      name: "Enviar mensaje por Instagram",
    }) as HTMLInputElement;
    expect(checkbox.checked).toBe(true);
    expect(checkbox.getAttribute("name")).toBe("sendMessage");
  });

  it("starts unchecked when defaultChecked is false", () => {
    render(<GuestMessageToggle defaultChecked={false} />);

    const checkbox = screen.getByRole("checkbox") as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
  });

  it("uses the given field name", () => {
    render(<GuestMessageToggle name="notifyGuest" />);

    expect(screen.getByRole("checkbox").getAttribute("name")).toBe("notifyGuest");
  });

  it("posts the field only while it is checked", () => {
    const { form } = renderInForm(<GuestMessageToggle />);
    const checkbox = screen.getByRole("checkbox");

    expect(new FormData(form).get("sendMessage")).toBe("on");

    fireEvent.click(checkbox);
    expect(new FormData(form).has("sendMessage")).toBe(false);

    fireEvent.click(checkbox);
    expect(new FormData(form).get("sendMessage")).toBe("on");
  });

  it("does not post the field when it starts unchecked", () => {
    const { form } = renderInForm(<GuestMessageToggle defaultChecked={false} />);

    expect(new FormData(form).has("sendMessage")).toBe(false);
  });

  it("toggles when its label text is clicked", () => {
    render(<GuestMessageToggle />);

    fireEvent.click(screen.getByText("Enviar mensaje por Instagram"));

    expect((screen.getByRole("checkbox") as HTMLInputElement).checked).toBe(false);
  });
});

describe("GuestMessageToggle preview", () => {
  it("offers no preview when none is given", () => {
    const { container } = render(<GuestMessageToggle />);

    expect(screen.queryByText("Ver mensaje")).toBeNull();
    expect(container.querySelector("details")).toBeNull();
  });

  it("keeps the preview collapsed until Ver mensaje is clicked", () => {
    const { container } = render(<GuestMessageToggle preview={preview} />);
    const details = container.querySelector("details")!;

    expect(details.open).toBe(false);

    fireEvent.click(screen.getByText("Ver mensaje"));
    expect(details.open).toBe(true);

    fireEvent.click(screen.getByText("Ver mensaje"));
    expect(details.open).toBe(false);
  });

  it("shows the preview text with its line breaks preserved", () => {
    const { container } = render(<GuestMessageToggle preview={preview} />);

    const text = container.querySelector("details p")!;
    expect(text.textContent).toBe(preview);
    expect(text.className).toContain("whitespace-pre-line");
  });

  it("does not affect what the form posts", () => {
    const { form } = renderInForm(<GuestMessageToggle preview={preview} />);

    fireEvent.click(screen.getByText("Ver mensaje"));

    expect(Array.from(new FormData(form).keys())).toEqual(["sendMessage"]);
  });
});
