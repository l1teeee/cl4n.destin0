// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ReservationForm } from "@/ui/public/reservation-form";

const turnstileMethods = vi.hoisted(() => ({
  reset: vi.fn(),
  getResponsePromise: vi.fn(),
}));
const turnstileCallbacks = vi.hoisted(() => ({
  onError: undefined as (() => void) | undefined,
}));
const sentryMethods = vi.hoisted(() => ({
  captureException: vi.fn(),
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: sentryMethods.captureException,
}));

vi.mock("@marsidev/react-turnstile", async () => {
  const { forwardRef, useEffect, useImperativeHandle } = await import("react");

  interface MockTurnstileProps {
    onSuccess(token: string): void;
    onError(): void;
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
      turnstileCallbacks.onError = props.onError;

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
    turnstileCallbacks.onError = undefined;
    sentryMethods.captureException.mockReset();
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

  it("sends one request when End is pressed twice in the same tick", async () => {
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

    act(() => {
      const eventOptions = { key: "End", bubbles: true, cancelable: true };
      slider.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
      slider.dispatchEvent(new KeyboardEvent("keydown", eventOptions));
    });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
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

  it("sends one request when End is pressed during a pointer grip", async () => {
    const handlers: Partial<Record<"pointerup", EventListener>> = {};
    const addEventListener = window.addEventListener.bind(window);
    vi.spyOn(window, "addEventListener").mockImplementation((type, listener, options) => {
      if (type === "pointerup" && typeof listener === "function") {
        handlers.pointerup = listener;
      }
      addEventListener(type, listener, options);
    });

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
    await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 10 });
    expect(handlers.pointerup).toBeDefined();
    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      handlers.pointerup?.({ isTrusted: true, pointerId: 1 } as PointerEvent);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(successResponse());
    expect(
      await screen.findByRole("heading", { name: "SOLICITUD CONFIRMADA" }, { timeout: 2500 }),
    ).toBeDefined();
  });

  it("keeps a confirmed reservation when Turnstile errors synchronously during reset", async () => {
    turnstileMethods.reset.mockImplementation(() => turnstileCallbacks.onError?.());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    fillValidFields();
    const slider = await screen.findByRole("slider", {
      name: "DESLIZA PARA SOLICITAR ACCESO",
    });
    await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));

    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(turnstileMethods.reset).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByRole("heading", { name: "SOLICITUD CONFIRMADA" }, { timeout: 2500 }),
    ).toBeDefined();
    expect(screen.getByText("#007")).toBeDefined();
  });

  it("shows confirmation when rotating the attempt key cannot write to storage", async () => {
    sessionStorage.setItem("cl4n:idem:cena-demo", "00000000-0000-4000-8000-000000000001");
    const storageError = new DOMException("Storage quota exceeded.", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw storageError;
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(successResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    fillValidFields();
    const slider = await screen.findByRole("slider", {
      name: "DESLIZA PARA SOLICITAR ACCESO",
    });
    await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));
    fireEvent.keyDown(slider, { key: "End" });

    expect(
      await screen.findByRole("heading", { name: "SOLICITUD CONFIRMADA" }, { timeout: 2500 }),
    ).toBeDefined();
    expect(screen.getByText("#007")).toBeDefined();
    expect(sentryMethods.captureException).toHaveBeenCalledOnce();
    expect(sentryMethods.captureException).toHaveBeenCalledWith(storageError);
  });

  it.each(["getItem", "setItem"] as const)(
    "submits with an in-memory key when sessionStorage.%s fails on mount",
    async (storageMethod) => {
      const storageError = new DOMException("Storage is blocked.", "SecurityError");
      vi.spyOn(Storage.prototype, storageMethod).mockImplementation(() => {
        throw storageError;
      });
      const fetchMock = vi.fn<typeof fetch>(() => new Promise<Response>(() => undefined));
      vi.stubGlobal("fetch", fetchMock);

      render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

      await screen.findByTestId("turnstile");
      fillValidFields();
      const slider = await screen.findByRole("slider", {
        name: "DESLIZA PARA SOLICITAR ACCESO",
      });
      await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));
      fireEvent.keyDown(slider, { key: "End" });

      await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
      const request = fetchMock.mock.calls[0]?.[1];
      expect(request?.headers).toMatchObject({
        "Idempotency-Key": expect.stringMatching(/.+/),
      });
      expect(sentryMethods.captureException).toHaveBeenCalledOnce();
      expect(sentryMethods.captureException).toHaveBeenCalledWith(storageError);
    },
  );

  it("retries TRY_AGAIN once with the same key and a fresh token", async () => {
    turnstileMethods.getResponsePromise.mockResolvedValue("fresh-token");
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            error: {
              code: "TRY_AGAIN",
              message: "Intenta de nuevo.",
            },
          }),
          {
            status: 503,
            headers: { "Content-Type": "application/json", "Retry-After": "0.001" },
          },
        ),
      )
      .mockResolvedValueOnce(successResponse());
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    fillValidFields();
    const slider = await screen.findByRole("slider", {
      name: "DESLIZA PARA SOLICITAR ACCESO",
    });
    await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));
    fireEvent.keyDown(slider, { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const firstRequest = fetchMock.mock.calls[0]?.[1];
    const secondRequest = fetchMock.mock.calls[1]?.[1];
    expect(firstRequest?.headers).toMatchObject({
      "Idempotency-Key": expect.any(String),
    });
    expect(secondRequest?.headers).toMatchObject({
      "Idempotency-Key": (firstRequest?.headers as Record<string, string>)["Idempotency-Key"],
    });
    expect(JSON.parse(String(firstRequest?.body)).turnstileToken).toBe("test-token");
    expect(JSON.parse(String(secondRequest?.body)).turnstileToken).toBe("fresh-token");
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
