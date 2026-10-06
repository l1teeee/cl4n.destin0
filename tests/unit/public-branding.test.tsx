// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import ConceptPage from "@/app/concepto/page";
import { PublicLanding } from "@/ui/public/public-landing";

afterEach(cleanup);

describe("public branding", () => {
  it("uses the vector mark in the header and landing page", () => {
    const { container } = render(
      <PublicLanding status="Acceso cerrado">
        <p>Pronto anunciaremos una nueva fecha.</p>
      </PublicLanding>,
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

  it("keeps the concept on its own route", () => {
    render(<PublicLanding status="Acceso cerrado">Pronto</PublicLanding>);

    expect(screen.getByRole("link", { name: "Qué es un supper clan" }).getAttribute("href")).toBe(
      "/concepto",
    );
    expect(screen.queryByRole("link", { name: "RSVP" })).toBeNull();
  });

  it("keeps the reservation anchor available for open events", () => {
    const { container } = render(
      <PublicLanding status="Acceso abierto" showReservationLink>
        Próxima fecha
      </PublicLanding>,
    );

    expect(screen.getByRole("link", { name: "RSVP" }).getAttribute("href")).toBe("#reservar");
    expect(container.querySelector("main#reservar")).not.toBeNull();
  });

  it("preserves the supplied wordmark and return link on the concept page", () => {
    render(<ConceptPage />);

    expect(
      screen.getByRole("img", { name: "Logotipo de Clandestino" }).getAttribute("src"),
    ).toContain("clandestino-wordmark.png");
    expect(screen.getByRole("link", { name: "Volver al inicio" }).getAttribute("href")).toBe("/");
  });
});
