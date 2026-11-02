// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import ConceptPage from "@/app/concepto/page";
import { PublicLanding } from "@/ui/public/public-landing";
import { PublicHeader } from "@/ui/public/public-header";
import { PublicFooter } from "@/ui/public/public-footer";
import { HomeExperience } from "@/ui/public/home-experience";
import { ClosedState } from "@/ui/public/closed-state";
import { publicMessages } from "@/ui/public/i18n/messages";
import { getPublicLocale } from "@/ui/public/i18n/locale";
import { LanguageSwitch } from "@/ui/public/language-switch";

const request = vi.hoisted(() => ({ language: undefined as string | undefined, refresh: vi.fn() }));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "cl4n_lang" && request.language !== undefined
        ? { value: request.language }
        : undefined,
  }),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: request.refresh }) }));

// Resolve the server components before passing their client children to the DOM renderer.
async function resolvePublicShell(node: ReactNode): Promise<ReactNode> {
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (node.type === PublicHeader) {
    return resolvePublicShell(
      await PublicHeader(node.props as ComponentProps<typeof PublicHeader>),
    );
  }
  if (node.type === PublicFooter) return resolvePublicShell(await PublicFooter());
  if (node.type === PublicLanding) {
    return resolvePublicShell(PublicLanding(node.props as ComponentProps<typeof PublicLanding>));
  }
  const children = await Promise.all(Children.toArray(node.props.children).map(resolvePublicShell));
  return children.length ? cloneElement(node, undefined, ...children) : node;
}

beforeEach(() => {
  request.language = undefined;
  request.refresh.mockClear();
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  document.cookie = "cl4n_lang=; Path=/; Max-Age=0";
});

describe("public branding", () => {
  it("uses the vector mark in the header and landing page", async () => {
    const { container } = render(
      await resolvePublicShell(
        <PublicLanding status="Acceso cerrado">
          <p>Pronto anunciaremos una nueva fecha.</p>
        </PublicLanding>,
      ),
    );

    const headerMark = container.querySelector("svg.public-header-mark");
    const homeMark = container.querySelector("svg.public-home-mark");
    expect(headerMark).not.toBeNull();
    expect(homeMark).not.toBeNull();
    expect(headerMark?.getAttribute("aria-hidden")).toBe("true");
    expect(homeMark?.getAttribute("aria-hidden")).toBe("true");
    expect(container.querySelector('img[src*="clandestino-logo"]')).toBeNull();
    expect(screen.getByRole("heading", { name: "Acceso cerrado" })).toBeDefined();
    expect(screen.getByText("Pronto anunciaremos una nueva fecha.")).toBeDefined();
  });

  it("keeps the concept on its own route", async () => {
    render(await resolvePublicShell(<PublicLanding status="Acceso cerrado">Pronto</PublicLanding>));

    expect(screen.getByRole("link", { name: "Qué es un supper clan" }).getAttribute("href")).toBe(
      "/concepto",
    );
    expect(screen.queryByRole("link", { name: "RSVP" })).toBeNull();
  });

  it("points the RSVP link at the supplied reservation href", async () => {
    const { container } = render(
      await resolvePublicShell(
        <PublicLanding status="Acceso abierto" reservationHref="/solicitar/cena-demo">
          Próxima fecha
        </PublicLanding>,
      ),
    );

    expect(screen.getByRole("link", { name: "RSVP" }).getAttribute("href")).toBe(
      "/solicitar/cena-demo",
    );
    expect(container.querySelector("#reservar")).toBeNull();
  });

  it("preserves the supplied wordmark and return link on the concept page", async () => {
    render(await resolvePublicShell(await ConceptPage()));

    expect(
      screen.getByRole("img", { name: "Logotipo de Clandestino" }).getAttribute("src"),
    ).toContain("clandestino-wordmark.png");
    expect(screen.getByRole("link", { name: "Volver al inicio" }).getAttribute("href")).toBe("/");
  });

  it("renders the English invitation cards and exact waitlist helper", async () => {
    request.language = "en";
    const dateParts = { weekday: "Saturday", day: "21", month: "November", time: "7:30 PM" };
    render(
      await resolvePublicShell(
        HomeExperience({
          messages: publicMessages.en.home,
          viewModel: {
            state: "OPEN",
            events: [
              { slug: "seats", formattedDate: "Available dinner", dateParts },
              { slug: "waitlist", formattedDate: "Full dinner", dateParts, waitlistOnly: true },
            ],
          },
        }),
      ),
    );
    const available = within(screen.getByRole("article", { name: "Available dinner" }));
    expect(available.getByText("Limited seats")).toBeDefined();
    expect(available.getByRole("link", { name: "Request access" }).getAttribute("href")).toBe(
      "/solicitar/seats",
    );
    const full = within(screen.getByRole("article", { name: "Full dinner" }));
    expect(full.getByText("Table full")).toBeDefined();
    expect(full.getByText("Join the waitlist in case a seat opens up.")).toBeDefined();
    expect(full.getByRole("link", { name: "Join the waitlist" }).getAttribute("href")).toBe(
      "/solicitar/waitlist",
    );
    expect(screen.getByRole("heading", { name: "How it works" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Privacy" })).toBeDefined();
  });

  it("renders the closed reservation variant in English", async () => {
    request.language = "en";
    render(await resolvePublicShell(await ClosedState({ variant: { state: "FULL" } })));
    expect(screen.getByRole("heading", { name: "THE CLAN IS CLOSED" })).toBeDefined();
    expect(screen.getByText("The seats for this experience are full.")).toBeDefined();
  });

  it.each([undefined, "", "fr", "EN", "es"])("defaults cookie %s to Spanish", async (language) => {
    request.language = language;
    expect(await getPublicLocale()).toBe("es");
  });

  it("reads the English cookie", async () => {
    request.language = "en";
    expect(await getPublicLocale()).toBe("en");
  });

  it("writes the language cookie and refreshes with accessible button states", () => {
    const writeCookie = vi.spyOn(document, "cookie", "set");
    const view = render(<LanguageSwitch locale="es" label="Idioma" />);
    const english = screen.getByRole("button", { name: "EN" });
    expect(screen.getByRole("group", { name: "Idioma" })).toBeDefined();
    expect(english.getAttribute("lang")).toBe("en");
    expect(english.getAttribute("aria-pressed")).toBe("false");
    expect(screen.getByRole("button", { name: "ES" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(english);
    expect(writeCookie).toHaveBeenLastCalledWith(
      "cl4n_lang=en; Path=/; SameSite=Lax; Max-Age=31536000",
    );
    expect(document.cookie).toContain("cl4n_lang=en");
    expect(request.refresh).toHaveBeenCalledOnce();
    view.rerender(<LanguageSwitch locale="en" label="Language" />);
    expect(screen.getByRole("group", { name: "Language" })).toBeDefined();
    expect(english.getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "ES" }));
    expect(writeCookie).toHaveBeenLastCalledWith(
      "cl4n_lang=es; Path=/; SameSite=Lax; Max-Age=31536000",
    );
    expect(request.refresh).toHaveBeenCalledTimes(2);
  });
});
