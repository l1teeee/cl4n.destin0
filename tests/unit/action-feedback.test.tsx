// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { ActionFeedbackProvider } from "@/ui/admin/action-feedback";
import { MutationForm } from "@/ui/admin/mutation-form";

beforeAll(() => {
  HTMLElement.prototype.hasPointerCapture = vi.fn();
  HTMLElement.prototype.releasePointerCapture = vi.fn();
  HTMLElement.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function Roster({ message, ok = true }: { message: string; ok?: boolean }) {
  const [rowVisible, setRowVisible] = useState(true);
  const action = vi.fn(async () => {
    setRowVisible(false);
    return { ok, message };
  });
  return (
    <ActionFeedbackProvider>
      {rowVisible ? <MutationForm action={action} label="Retirar" reportToSection /> : null}
    </ActionFeedbackProvider>
  );
}

describe("ActionFeedbackProvider", () => {
  it("keeps the success message after the reporting row unmounts and can be dismissed", async () => {
    render(<Roster message="Entrada retirada de la cola." />);

    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));

    await waitFor(() => expect(screen.getByText("Entrada retirada de la cola.")).toBeTruthy());
    expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Cerrar" }));
    expect(screen.queryByText("Entrada retirada de la cola.")).toBeNull();
  });

  it("keeps errors inside the form", async () => {
    render(<Roster message="No se pudo retirar." ok={false} />);

    fireEvent.click(screen.getByRole("button", { name: "Retirar" }));

    await waitFor(() => expect(screen.queryByRole("button", { name: "Retirar" })).toBeNull());
    expect(screen.queryByText("No se pudo retirar.")).toBeNull();
  });
});
