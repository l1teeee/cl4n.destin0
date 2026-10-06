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

describe("ReservationForm", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "test-site-key");
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

  it("mounts without an update loop and enables submission after Turnstile succeeds", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);

    expect(() =>
      render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />),
    ).not.toThrow();

    expect(await screen.findByTestId("turnstile")).toBeDefined();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "SOLICITAR ACCESO" }).hasAttribute("disabled"),
      ).toBe(false);
    });

    const errorOutput = consoleError.mock.calls.flat().join(" ");
    expect(errorOutput).not.toContain("Maximum update depth exceeded");
  });

  it("submits valid fields with the Turnstile token and resets the widget", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
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
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    render(<ReservationForm eventSlug="cena-demo" maxPartySize={2} formattedDate="Sabado" />);

    await screen.findByTestId("turnstile");
    const submitButton = screen.getByRole("button", { name: "SOLICITAR ACCESO" });
    await waitFor(() => {
      expect(submitButton.hasAttribute("disabled")).toBe(false);
    });
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
      target: { value: "2" },
    });
    fireEvent.click(screen.getByRole("checkbox"));
    const form = submitButton.closest("form");
    expect(form).not.toBeNull();
    fireEvent.submit(form as HTMLFormElement);

    expect(await screen.findByRole("heading", { name: "SOLICITUD CONFIRMADA" })).toBeDefined();
    expect(turnstileMethods.reset).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const [, request] = fetchMock.mock.calls[0] ?? [];
    expect(request?.headers).toMatchObject({
      "Content-Type": "application/json",
      "Idempotency-Key": expect.any(String),
    });
    expect(JSON.parse(String(request?.body))).toMatchObject({
      eventSlug: "cena-demo",
      partySize: 2,
      turnstileToken: "test-token",
    });
  });
});
