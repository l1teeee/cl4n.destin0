// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MessageSimulatorPanel } from "@/ui/admin/messages/message-simulator-panel";

afterEach(cleanup);

const action = vi.fn(async () => ({ ok: true, message: "" }));

describe("MessageSimulatorPanel", () => {
  it("renders only in local or test log mode", () => {
    const view = render(
      <MessageSimulatorPanel mode="instagram" appEnvironment="local" action={action} />,
    );
    expect(screen.queryByText("Simulador (solo local)")).toBeNull();

    view.rerender(<MessageSimulatorPanel mode="log" appEnvironment="production" action={action} />);
    expect(screen.queryByText("Simulador (solo local)")).toBeNull();

    view.rerender(<MessageSimulatorPanel mode="log" appEnvironment="test" action={action} />);
    expect(screen.getByText("Simulador (solo local)")).toBeDefined();
    expect(
      screen.getByText(
        "Simula que una persona escribe por Instagram, por ejemplo con el código de su solicitud.",
      ),
    ).toBeDefined();
  });
});
