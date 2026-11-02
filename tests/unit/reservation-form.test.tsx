// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { FieldError, ReservationForm } from "@/ui/public/reservation-form";

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

const receivedLinkCode = "K7M2QX";
const waitlistedLinkCode = "R4T9HB";
const instagramUsername = "clandestino.sv";

function renderForm(maxPartySize = 2) {
  return render(
    <ReservationForm eventSlug="cena-demo" maxPartySize={maxPartySize} formattedDate="Sabado" />,
  );
}

function fillGuest(group: HTMLElement, name: string, instagram: string) {
  fireEvent.change(within(group).getByLabelText("Nombre completo"), { target: { value: name } });
  fireEvent.change(within(group).getByLabelText("Usuario de Instagram"), {
    target: { value: instagram },
  });
}

function answerAllergiesAndAcceptTerms(allergies?: string) {
  if (allergies) {
    fireEvent.click(screen.getByRole("radio", { name: "Sí" }));
    fireEvent.change(screen.getByLabelText(/^¿(Quién y )?a qué\?$/i), {
      target: { value: allergies },
    });
  } else {
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
  }
  fireEvent.click(screen.getByRole("checkbox"));
}

async function fillAsSolo() {
  fireEvent.click(screen.getByRole("radio", { name: "Solo" }));
  fillGuest(
    await screen.findByRole("group", { name: "Tus datos" }),
    "Ana Martinez",
    "ana.martinez",
  );
  answerAllergiesAndAcceptTerms();
}

async function fillAsCouple(allergies?: string) {
  fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
  fillGuest(
    await screen.findByRole("group", { name: "Invitado 1" }),
    "Ana Martinez",
    "ana.martinez",
  );
  fillGuest(await screen.findByRole("group", { name: "Invitado 2" }), "Luis Perez", "luis.perez");
  answerAllergiesAndAcceptTerms(allergies);
}

// The party question does not exist when the event allows one person.
function fillOnlyGuestOfSingleEvent() {
  fillGuest(screen.getByRole("group", { name: "Tus datos" }), "Ana Martinez", "ana.martinez");
  answerAllergiesAndAcceptTerms();
}

async function waitForSliderReady() {
  const slider = await screen.findByRole("slider", { name: "DESLIZA PARA SOLICITAR ACCESO" });
  await waitFor(() => expect(slider.hasAttribute("aria-disabled")).toBe(false));
  return slider;
}

function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function receivedResponse(partySize = 2) {
  return jsonResponse(201, {
    status: "RECEIVED",
    request: {
      number: 7,
      partySize,
      eventStartsAt: "2026-10-10T01:00:00.000Z",
      linkCode: receivedLinkCode,
    },
  });
}

function waitlistedResponse() {
  return jsonResponse(202, {
    status: "WAITLISTED",
    waitlist: {
      position: 3,
      partySize: 2,
      eventStartsAt: "2026-10-10T01:00:00.000Z",
      linkCode: waitlistedLinkCode,
    },
  });
}

function sentBody(fetchMock: ReturnType<typeof vi.fn<typeof fetch>>) {
  return JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
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

    expect(() => renderForm()).not.toThrow();

    expect(await screen.findByTestId("turnstile")).toBeDefined();
    const disabledSlider = screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" });
    expect(disabledSlider.getAttribute("aria-disabled")).toBe("true");
    expect(disabledSlider.getAttribute("aria-describedby")).toBe("reservation-slide-hint");
    const slideCommit = disabledSlider.closest(".slide-commit");
    expect(slideCommit).not.toBeNull();
    await waitFor(() => expect(slideCommit?.hasAttribute("data-measured")).toBe(true));

    await fillAsCouple();
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

  it("stays disabled until the second guest is filled for a couple", async () => {
    renderForm();

    await screen.findByTestId("turnstile");
    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    fillGuest(
      await screen.findByRole("group", { name: "Invitado 1" }),
      "Ana Martinez",
      "ana.martinez",
    );
    answerAllergiesAndAcceptTerms();
    expect(
      screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" }).getAttribute("aria-disabled"),
    ).toBe("true");

    fillGuest(screen.getByRole("group", { name: "Invitado 2" }), "Luis Perez", "luis.perez");
    await waitForSliderReady();
  });

  it("shows an invalid Instagram user on blur", async () => {
    renderForm();
    await screen.findByTestId("turnstile");
    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    const instagram = within(screen.getByRole("group", { name: "Invitado 1" })).getByLabelText(
      "Usuario de Instagram",
    );
    fireEvent.change(instagram, { target: { value: "con espacio" } });
    fireEvent.blur(instagram);
    expect(await screen.findByText("Ingresa un usuario de Instagram válido.")).toBeDefined();
    expect(instagram.getAttribute("aria-invalid")).toBe("true");
  });

  it("stays disabled when both guests use the same Instagram user", async () => {
    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    const guest2Instagram = within(
      screen.getByRole("group", { name: "Invitado 2" }),
    ).getByLabelText("Usuario de Instagram");
    fireEvent.change(guest2Instagram, { target: { value: "@Ana.Martinez" } });
    fireEvent.blur(guest2Instagram);

    expect(
      await screen.findByText("Cada invitado necesita su propio usuario de Instagram."),
    ).toBeDefined();
    expect(
      screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" }).getAttribute("aria-disabled"),
    ).toBe("true");
  });

  it("reserves one error line even without a message", () => {
    const { container } = render(<FieldError />);
    const errorLine = container.querySelector(".reservation-field-error");

    expect(errorLine).not.toBeNull();
    expect(errorLine?.getAttribute("aria-live")).toBe("polite");
    expect(errorLine?.textContent).toBe("");
    expect(errorLine?.classList.contains("min-h-5")).toBe(true);
  });

  it("selects Solo by default on the first render", () => {
    renderForm();

    const question = screen.getByRole("radiogroup", { name: "¿Cuántas personas?" });
    const solo = within(question).getByRole("radio", { name: "Solo" });
    const couple = within(question).getByRole("radio", { name: "En pareja" });
    expect(question.getAttribute("aria-required")).toBe("true");
    expect(solo.getAttribute("aria-checked")).toBe("true");
    expect(couple.getAttribute("aria-checked")).toBe("false");
    expect(screen.getByRole("group", { name: "Tus datos" })).toBeDefined();
    expect(screen.queryByRole("group", { name: "Invitado 2" })).toBeNull();
  });

  it("sends a solo request without touching the party control", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse(1));
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    fillGuest(screen.getByRole("group", { name: "Tus datos" }), "Ana Martinez", "ana.martinez");
    answerAllergiesAndAcceptTerms();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).toMatchObject({ partySize: 1, guest1Name: "Ana Martinez" });
  });

  it("asks for one person under Tus datos", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "Solo" }));

    const guest = await screen.findByRole("group", { name: "Tus datos" });
    expect(within(guest).getByLabelText("Nombre completo").getAttribute("autocomplete")).toBe(
      "name",
    );
    expect(within(guest).getByLabelText("Usuario de Instagram").getAttribute("autocomplete")).toBe(
      "off",
    );
    expect(screen.queryByRole("group", { name: "Invitado 1" })).toBeNull();
    expect(screen.queryByRole("group", { name: "Invitado 2" })).toBeNull();
    expect(screen.getAllByLabelText("Nombre completo")).toHaveLength(1);
    expect(screen.queryByLabelText("Email")).toBeNull();
    expect(screen.queryByLabelText(/Tel.fono/)).toBeNull();
  });

  it("asks for each guest of a couple in their own section", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));

    const guest1 = await screen.findByRole("group", { name: "Invitado 1" });
    const guest2 = await screen.findByRole("group", { name: "Invitado 2" });
    expect(screen.queryByRole("group", { name: "Tus datos" })).toBeNull();
    expect(within(guest1).getByLabelText("Nombre completo").getAttribute("autocomplete")).toBe(
      "name",
    );
    expect(within(guest2).getByLabelText("Nombre completo").getAttribute("autocomplete")).toBe(
      "off",
    );
    expect(within(guest1).getByLabelText("Usuario de Instagram").getAttribute("autocomplete")).toBe(
      "off",
    );
    expect(within(guest2).getByLabelText("Usuario de Instagram").getAttribute("autocomplete")).toBe(
      "off",
    );
  });

  it("removes the second guest and their values when switching back to one person", async () => {
    renderForm();

    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    fillGuest(await screen.findByRole("group", { name: "Invitado 2" }), "Luis Perez", "luis.perez");

    fireEvent.click(screen.getByRole("radio", { name: "Solo" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Invitado 2" })).toBeNull());

    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    const reopened = await screen.findByRole("group", { name: "Invitado 2" });
    const name = within(reopened).getByLabelText("Nombre completo") as HTMLInputElement;
    const instagram = within(reopened).getByLabelText("Usuario de Instagram") as HTMLInputElement;
    expect(name.value).toBe("");
    expect(instagram.value).toBe("");
  });

  it("hides the party question and sends one person when the event allows only one", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse(1));
    vi.stubGlobal("fetch", fetchMock);

    renderForm(1);

    await screen.findByTestId("turnstile");
    expect(screen.queryByRole("radiogroup", { name: "¿Cuántas personas?" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "Solo" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "En pareja" })).toBeNull();
    fillOnlyGuestOfSingleEvent();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).toMatchObject({ partySize: 1, guest1Name: "Ana Martinez" });
  });

  it("switches the allergy legend, label and help with the party", async () => {
    renderForm();

    expect(screen.getByRole("radiogroup", { name: "¿Tienes alergias?" })).toBeDefined();
    fireEvent.click(screen.getByRole("radio", { name: "Sí" }));
    expect(await screen.findByLabelText("¿A qué?")).toBeDefined();
    expect(screen.queryByText("Indica de quién es cada alergia.")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    expect(
      await screen.findByRole("radiogroup", { name: "¿Alguno de los dos tiene alergias?" }),
    ).toBeDefined();
    const description = screen.getByLabelText("¿Quién y a qué?");
    expect(screen.getByText("Indica de quién es cada alergia.")).toBeDefined();
    expect(description.getAttribute("aria-describedby")).toBe("allergies-help");
    expect(screen.queryByLabelText("¿A qué?")).toBeNull();

    fireEvent.click(screen.getByRole("radio", { name: "Solo" }));
    expect(await screen.findByLabelText("¿A qué?")).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "¿Tienes alergias?" })).toBeDefined();
    expect(screen.queryByText("Indica de quién es cada alergia.")).toBeNull();
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

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    const slider = await waitForSliderReady();

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
      guest1Name: "Ana Martinez",
      guest1Instagram: "ana.martinez",
      guest2Name: "Luis Perez",
      guest2Instagram: "luis.perez",
      hasAllergies: false,
      acceptTerms: true,
      turnstileToken: "test-token",
    });
    expect(JSON.parse(String(request?.body))).not.toHaveProperty("allergies");

    resolveFetch(receivedResponse());
    await waitFor(() => expect(turnstileMethods.reset).toHaveBeenCalledTimes(1));
    const slideCommit = slider.closest(".slide-commit");
    expect(slideCommit).not.toBeNull();
    await waitFor(() => expect(slideCommit?.getAttribute("data-phase")).toBe("done"));
    expect(screen.queryByRole("heading", { name: "¡FELICIDADES!" })).toBeNull();
    expect(
      await screen.findByRole("heading", { name: "¡FELICIDADES!" }, { timeout: 2500 }),
    ).toBeDefined();
  });

  it("sends no email, phone or second guest for one person", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse(1));
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsSolo();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = sentBody(fetchMock);
    expect(body).toMatchObject({
      eventSlug: "cena-demo",
      partySize: 1,
      guest1Name: "Ana Martinez",
      guest1Instagram: "ana.martinez",
      hasAllergies: false,
      acceptTerms: true,
      turnstileToken: "test-token",
    });
    for (const absentField of [
      "email",
      "phone",
      "fullName",
      "instagram",
      "guest2Name",
      "guest2Instagram",
      "allergies",
    ]) {
      expect(body).not.toHaveProperty(absentField);
    }
  });

  it("does not send the second guest after switching back to one person", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse(1));
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    fireEvent.click(screen.getByRole("radio", { name: "En pareja" }));
    fillGuest(
      await screen.findByRole("group", { name: "Invitado 1" }),
      "Ana Martinez",
      "ana.martinez",
    );
    fillGuest(await screen.findByRole("group", { name: "Invitado 2" }), "Luis Perez", "luis.perez");
    fireEvent.click(screen.getByRole("radio", { name: "Solo" }));
    await waitFor(() => expect(screen.queryByRole("group", { name: "Invitado 2" })).toBeNull());
    answerAllergiesAndAcceptTerms();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const body = sentBody(fetchMock);
    expect(body).toMatchObject({ partySize: 1, guest1Name: "Ana Martinez" });
    expect(body).not.toHaveProperty("guest2Name");
    expect(body).not.toHaveProperty("guest2Instagram");
  });

  it("sends both guests and the allergy description for a couple that answers yes", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse());
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple("Ana: maní");
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(sentBody(fetchMock)).toMatchObject({
      partySize: 2,
      guest1Name: "Ana Martinez",
      guest1Instagram: "ana.martinez",
      guest2Name: "Luis Perez",
      guest2Instagram: "luis.perez",
      hasAllergies: true,
      allergies: "Ana: maní",
    });
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

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    const slider = await waitForSliderReady();

    fireEvent.pointerDown(slider, { button: 0, pointerId: 1, clientX: 10 });
    expect(handlers.pointerup).toBeDefined();
    fireEvent.keyDown(slider, { key: "End" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => {
      handlers.pointerup?.({ isTrusted: true, pointerId: 1 } as PointerEvent);
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    resolveFetch(receivedResponse());
    expect(
      await screen.findByRole("heading", { name: "¡FELICIDADES!" }, { timeout: 2500 }),
    ).toBeDefined();
  });

  it("keeps a received request when Turnstile errors synchronously during reset", async () => {
    turnstileMethods.reset.mockImplementation(() => turnstileCallbacks.onError?.());
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse());
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(turnstileMethods.reset).toHaveBeenCalledTimes(1));

    expect(
      await screen.findByRole("heading", { name: "¡FELICIDADES!" }, { timeout: 2500 }),
    ).toBeDefined();
    expect(screen.getByText("2 personas · Sabado")).toBeDefined();
  });

  it("shows confirmation when rotating the attempt key cannot write to storage", async () => {
    sessionStorage.setItem("cl4n:idem:cena-demo", "00000000-0000-4000-8000-000000000001");
    const storageError = new DOMException("Storage quota exceeded.", "QuotaExceededError");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw storageError;
    });
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(receivedResponse());
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    expect(
      await screen.findByRole("heading", { name: "¡FELICIDADES!" }, { timeout: 2500 }),
    ).toBeDefined();
    expect(screen.getByText("2 personas · Sabado")).toBeDefined();
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

      renderForm();

      await screen.findByTestId("turnstile");
      await fillAsCouple();
      fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

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
        jsonResponse(
          503,
          { error: { code: "TRY_AGAIN", message: "Intenta de nuevo." } },
          { "Retry-After": "0.001" },
        ),
      )
      .mockResolvedValueOnce(receivedResponse());
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

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
      await screen.findByRole("heading", { name: "¡FELICIDADES!" }, { timeout: 2500 }),
    ).toBeDefined();
  });

  async function submitAndWaitForHeading(
    response: Response,
    heading: string,
    fill: () => Promise<void> = fillAsCouple,
  ) {
    vi.stubGlobal("fetch", vi.fn<typeof fetch>().mockResolvedValue(response));

    renderForm();

    await screen.findByTestId("turnstile");
    await fill();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    await screen.findByRole("heading", { name: heading }, { timeout: 2500 });
  }

  it("shows the received screen with the details line and the Instagram step", async () => {
    vi.stubEnv("NEXT_PUBLIC_INSTAGRAM_USERNAME", instagramUsername);
    await submitAndWaitForHeading(receivedResponse(), "¡FELICIDADES!");

    expect(
      screen.getByText(
        "Completaste el formulario. Te confirmaremos por Instagram para saber si estás en la lista.",
      ),
    ).toBeDefined();
    expect(screen.getByText("2 personas · Sabado")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Último paso" })).toBeDefined();
    expect(
      screen.getByText(
        "Para poder escribirte, envíanos un mensaje por Instagram a @clandestino.sv.",
      ),
    ).toBeDefined();
    const chatLink = screen.getByRole("link", { name: "Abrir chat en Instagram" });
    expect(chatLink.getAttribute("href")).toBe(`https://ig.me/m/clandestino.sv?ref=K7M2QX`);
    expect(chatLink.getAttribute("target")).toBe("_blank");
    expect(chatLink.getAttribute("rel")).toBe("noopener noreferrer");
    expect(screen.getByText(/^Tu código:/)).toBeDefined();
    expect(screen.getByText(receivedLinkCode).tagName).toBe("CODE");
    expect(
      screen.getByText("Si escribes desde la computadora, envíanos este código en el mensaje."),
    ).toBeDefined();
  });

  it("uses the singular for one person", async () => {
    await submitAndWaitForHeading(receivedResponse(1), "¡FELICIDADES!", fillAsSolo);

    expect(screen.getByText("1 persona · Sabado")).toBeDefined();
  });

  it("shows the queue screen and the Instagram step when the guest is waitlisted", async () => {
    vi.stubEnv("NEXT_PUBLIC_INSTAGRAM_USERNAME", instagramUsername);
    await submitAndWaitForHeading(waitlistedResponse(), "ESTÁS EN LA COLA");

    expect(
      screen.getByText(
        "Completaste el formulario, pero el cupo ya se llenó. Quedaste en la posición #3 de la cola.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Si se libera un lugar te escribiremos por Instagram.")).toBeDefined();
    expect(screen.getByText("2 personas · Sabado")).toBeDefined();
    expect(screen.getByRole("heading", { name: "Último paso" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir chat en Instagram" }).getAttribute("href")).toBe(
      "https://ig.me/m/clandestino.sv?ref=R4T9HB",
    );
    expect(screen.getByText(waitlistedLinkCode).tagName).toBe("CODE");
  });

  it("drops a leading @ from the configured Instagram username", async () => {
    vi.stubEnv("NEXT_PUBLIC_INSTAGRAM_USERNAME", " @clandestino.sv ");
    await submitAndWaitForHeading(receivedResponse(), "¡FELICIDADES!");

    expect(
      screen.getByText(
        "Para poder escribirte, envíanos un mensaje por Instagram a @clandestino.sv.",
      ),
    ).toBeDefined();
    expect(screen.getByRole("link", { name: "Abrir chat en Instagram" }).getAttribute("href")).toBe(
      "https://ig.me/m/clandestino.sv?ref=K7M2QX",
    );
  });

  it("still shows the code without the chat button when the Instagram username is not set", async () => {
    vi.stubEnv("NEXT_PUBLIC_INSTAGRAM_USERNAME", "");
    await submitAndWaitForHeading(receivedResponse(), "¡FELICIDADES!");

    expect(screen.getByRole("heading", { name: "Último paso" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Abrir chat en Instagram" })).toBeNull();
    expect(screen.queryByText(/Para poder escribirte/)).toBeNull();
    expect(screen.queryByText(/@/)).toBeNull();
    expect(screen.getByText(/^Tu código:/)).toBeDefined();
    expect(screen.getByText(receivedLinkCode).tagName).toBe("CODE");
    expect(
      screen.getByText("Envíanos este código por mensaje directo en Instagram."),
    ).toBeDefined();
    expect(screen.queryByText(/desde la computadora/)).toBeNull();
  });

  it("replaces the form when the event and waitlist fill during entry", async () => {
    const response = jsonResponse(409, {
      error: { code: "EVENT_FULL", message: "Los cupos para esta experiencia se agotaron." },
    });
    await submitAndWaitForHeading(response, "SIN LUGARES DISPONIBLES");

    expect(
      screen.getByText("Los lugares y la cola se llenaron mientras llenabas el formulario."),
    ).toBeDefined();
    expect(screen.getByText("Mantente atento a la próxima apertura del clan.")).toBeDefined();
    expect(screen.queryByText(/Completaste el formulario/)).toBeNull();
    expect(screen.queryByText(/personas/)).toBeNull();
    expect(screen.queryByText(/Último paso/)).toBeNull();
  });

  it("keeps the stored full rejection panel copy", async () => {
    const response = jsonResponse(201, { status: "FULL_REJECTED" });
    await submitAndWaitForHeading(response, "SIN LUGARES DISPONIBLES");

    expect(
      screen.getByText(
        "Registramos tu solicitud, pero ya no hay lugares disponibles para tu grupo.",
      ),
    ).toBeDefined();
    expect(screen.getByText("Mantente atento a la próxima apertura del clan.")).toBeDefined();
  });

  it("replaces the form when the event closes during entry", async () => {
    const response = jsonResponse(409, {
      error: { code: "EVENT_NOT_OPEN", message: "El clan está cerrado." },
    });
    await submitAndWaitForHeading(response, "EL CLAN SE CERRÓ");

    expect(
      screen.getByText("Las solicitudes se cerraron mientras llenabas el formulario."),
    ).toBeDefined();
    expect(screen.getByText("Mantente atento a la próxima apertura del clan.")).toBeDefined();
    expect(screen.queryByText(/Completaste el formulario/)).toBeNull();
  });

  it("explains a duplicate Instagram user and keeps the form", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(409, {
        error: { code: "DUPLICATE_RESERVATION", message: "Mensaje distinto del servidor." },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
    fireEvent.keyDown(await waitForSliderReady(), { key: "End" });

    expect(
      await screen.findByText("Ya existe una solicitud con este usuario de Instagram."),
    ).toBeDefined();
    expect(screen.getByRole("group", { name: "Invitado 1" })).toBeDefined();
    expect(screen.queryByRole("heading", { name: "¡FELICIDADES!" })).toBeNull();
  });

  it("shows server field errors and returns the slider home after an error", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse(422, {
        error: {
          code: "VALIDATION_FAILED",
          message: "Revisa los datos enviados.",
          fields: { guest1Name: ["El nombre fue rechazado."] },
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    renderForm();

    await screen.findByTestId("turnstile");
    await fillAsCouple();
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

  it("shows every field error and focuses the name first when disabled", async () => {
    renderForm();

    await screen.findByTestId("turnstile");
    const slider = screen.getByRole("slider", { name: "COMPLETA EL FORMULARIO" });
    const wrapper = slider.closest(".reservation-slide");
    expect(wrapper).not.toBeNull();
    fireEvent.click(wrapper as HTMLElement);

    expect(await screen.findByText("El nombre completo es obligatorio.")).toBeDefined();
    expect(screen.getByText("El usuario de Instagram es obligatorio.")).toBeDefined();
    expect(screen.queryByText("Elige si vienes solo o en pareja.")).toBeNull();
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByLabelText("Nombre completo"));
    });
  });

  it("focuses the name when the event allows one person and the form is disabled", async () => {
    renderForm(1);

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
    renderForm();

    await screen.findByTestId("turnstile");
    const noOption = screen.getByRole("radio", { name: "No" }) as HTMLInputElement;
    const yesOption = screen.getByRole("radio", { name: "Sí" }) as HTMLInputElement;
    expect(noOption.checked).toBe(false);
    expect(yesOption.checked).toBe(false);
    expect(screen.queryByLabelText("¿A qué?")).toBeNull();

    fireEvent.click(yesOption);
    const description = await screen.findByLabelText("¿A qué?");
    fireEvent.change(description, { target: { value: "Maní" } });

    fireEvent.click(noOption);
    await waitFor(() => {
      expect(screen.queryByLabelText("¿A qué?")).toBeNull();
    });

    fireEvent.click(yesOption);
    expect(((await screen.findByLabelText("¿A qué?")) as HTMLTextAreaElement).value).toBe("");
  });
});
