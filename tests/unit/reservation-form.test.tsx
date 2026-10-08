// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationForm } from "@/ui/public/reservation-form";

const turnstileMethods = vi.hoisted(() => ({
  reset: vi.fn(),
  getResponsePromise: vi.fn(),
}));

vi.mock("@marsidev/react-turnstile", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");

  interface MockTurnstileProps {
    onSuccess(token: string): void;
  }

  return {
    Turnstile: forwardRef(function MockTurnstile(
      props: MockTurnstileProps,
      ref: React.ForwardedRef<typeof turnstileMethods>,
    ) {
      const { onSuccess } = props;
      useImperativeHandle(ref, () => ({
        reset: turnstileMethods.reset,
        getResponsePromise: turnstileMethods.getResponsePromise,
      }));
      useEffect(() => {
        onSuccess("test-token");
      }, [onSuccess]);

      return <div data-testid="turnstile" />;
    }),
  };
});

vi.mock("next/link", () => ({
  default: ({ children, href }: React.ComponentProps<"a">) => <a href={href}>{children}</a>,
}));

function fillValidFields(partySize = "2") {
  fireEvent.change(screen.getByLabelText("Nombre completo"), {
    target: { value: "Ana Martinez" },
  });
  fireEvent.change(screen.getByLabelText("Usuario de Instagram"), {
    target: { value: "ana.martinez" },
  });
  fireEvent.change(screen.getByLabelText(/Tel.fono/), {
    target: { value: "+503 7000 0000" },
  });
  fireEvent.change(screen.getByLabelText("Email"), {
    target: { value: "ana@example.com" },
  });
  fireEvent.change(screen.getByLabelText("Cantidad de personas"), {
    target: { value: partySize },
  });
  fireEvent.click(screen.getByRole("radio", { name: "No" }));
  fireEvent.click(screen.getByRole("checkbox"));
}

function successResponse() {
  return new Response(
    JSON.stringify({
      status: "CONFIRMED",
      reservation: {
        number: 7,
        partySize: 2,
        eventStartsAt: "2026-10-10T01:00:00.000Z",
      },
    }),
    {
      status: 201,
      headers: { "Content-Type": "application/json" },
    },
  );
}

describe("ReservationForm", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
    vi.stubGlobal(
      "matchMedia",
      vi.fn().mockImplementation((query: string) => ({
        matches: false,
        media: query,
        onchange: null,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        addListener: vi.fn(),
        removeListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    );
    vi.stubGlobal(
      "ResizeObserver",
      class {
        private readonly callback: ResizeObserverCallback;

        constructor(callback: ResizeObserverCallback) {
          this.callback = callback;
        }

        observe(target: Element) {
          this.callback(
            [
              {
                target,
                contentRect: { width: 280 } as DOMRectReadOnly,
              } as ResizeObserverEntry,
            ],
            this as unknown as ResizeObserver,
          );
        }
        unobserve() {}
        disconnect() {}
      },
    );
    turnstileMethods.reset.mockReset();
    turnstileMethods.getResponsePromise.mockReset();
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    sessionStorage.clear();
  });

  it("stays disabled until the form and verification are ready", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />),
    ).not.toThrow();

    expect(await screen.findByTestId("turnstile")).toBeDefined();
    const disabledSlider = screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" });
    expect(disabledSlider.getAttribute("aria-disabled")).toBe("true");
    expect(disabledSlider.getAttribute("aria-describedby")).toBe("reservation-slide-hint");
    const slideCommit = disabledSlider.closest(".slide-commit");
    expect(slideCommit).not.toBeNull();
    await waitFor(() => expect(slideCommit?.hasAttribute("data-measured")).toBe(true));

    fillValidFields();
    await waitFor(() => {
      expect(
        screen
          .getByRole("slider", { name: "DESLIZA PARA SOLICITAR ACCESO" })
          .hasAttribute("aria-disabled"),
      ).toBe(false);
    });

    const errorOutput = consoleError.mock.calls.flat().join(" ");
    expect(errorOutput).not.toContain("Maximum update depth exceeded");
  });

  it("sends one request per slide and shows confirmation after the done delay", async () => {
    let resolveFetch: (response: Response) => void = () => {};
    const fetchMock = vi.fn<typeof fetch>(
      () =>
        new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    fillValidFields();
    const slider = await screen.findByRole("slider", {
      name: "DESLIZA PARA SOLICITAR ACCESO",
    });
    await waitFor(() => {
      expect(slider.hasAttribute("aria-disabled")).toBe(false);
    });

    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(slider, { key: "End" });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": expect.any(String),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      eventSlug: "cena-demo",
      partySize: 2,
      hasAllergies: false,
      turnstileToken: "test-token",
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("allergies");

    resolveFetch(successResponse());
    await waitFor(() => expect(turnstileMethods.reset).toHaveBeenCalledTimes(1));
    const slideCommit = slider.closest(".slide-commit");
    expect(slideCommit).not.toBeNull();
    await waitFor(() => expect(slideCommit?.getAttribute("data-phase")).toBe("done"));
    expect(screen.queryByRole("heading", { name: "SOLICITUD CONFIRMADA" })).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "SOLICITUD CONFIRMADA" }, { timeout: 2500 }),
    ).toBeDefined();
  });

  it("shows server field errors and returns the slider home after an error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          error: {
            code: "VALIDATION_FAILED",
            message: "Revisa los datos enviados.",
            fields: { fullName: ["El nombre fue rechazado."] },
          },
        }),
        {
          status: 422,
          headers: { "Content-Type": "application/json" },
        },
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    fillValidFields();
    const slider = await screen.findByRole("slider", {
      name: "DESLIZA PARA SOLICITAR ACCESO",
    });
    fireEvent.keyDown(slider, { key: "End" });

    expect(await screen.findByText("Revisa los datos enviados.")).toBeDefined();
    expect(await screen.findByText("El nombre fue rechazado.")).toBeDefined();
    const slideCommit = slider.closest(".slide-commit");
    expect(slideCommit).not.toBeNull();
    await waitFor(() => expect(slideCommit?.getAttribute("data-phase")).toBe("error"));
    await waitFor(() => expect(slideCommit?.getAttribute("data-phase")).toBe("idle"), {
      timeout: 2500,
    });
  });

  it("shows every field error and focuses the first invalid field when disabled", async () => {
    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    const slider = screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" });
    const wrapper = slider.closest(".reservation-slide");
    expect(wrapper).not.toBeNull();
    fireEvent.click(wrapper as HTMLElement);

    expect(await screen.findByText("El nombre completo es obligatorio.")).toBeDefined();
    expect(screen.getByText("El usuario de Instagram es obligatorio.")).toBeDefined();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Nombre completo"));
    });
  });

  it("shows, clears and removes the allergy description based on the radio selection", async () => {
    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    const noOption = screen.getByRole("radio", { name: "No" }) as HTMLInputElement;
    const yesOption = screen.getByRole("radio", { name: "Sí" }) as HTMLInputElement;
    expect(noOption.checked).toBe(false);
    expect(yesOption.checked).toBe(false);
    expect(screen.queryByLabelText("¿A qué?")).toBeNull();

    fireEvent.click(yesOption);
    const description = await screen.findByLabelText("¿A qué?");
    expect(screen.getByText("Incluye las de tu grupo si vienes acompañado.")).toBeDefined();
    fireEvent.change(description, { target: { value: "Maní" } });

    fireEvent.click(noOption);
    await waitFor(() => {
      expect(screen.queryByLabelText("¿A qué?")).toBeNull();
    });

    fireEvent.click(yesOption);
    expect(((await screen.findByLabelText("¿A qué?")) as HTMLTextAreaElement).value).toBe("");
  });
});
