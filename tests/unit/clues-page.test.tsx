// @vitest-environment jsdom

import {
  act,
  Children,
  cloneElement,
  isValidElement,
  type ComponentProps,
  type ReactNode,
} from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { EventClue } from "@/application/events/event-clue-repository";
import type { EventPhase } from "@/domain/event/event-phase";
import { formatPublicEventDate } from "@/infrastructure/time/el-salvador-time";
import { PublicHeader } from "@/ui/public/public-header";

const { getPublicEventBySlug, listForSlug, refresh, request } = vi.hoisted(() => ({
  getPublicEventBySlug: vi.fn(),
  listForSlug: vi.fn(),
  refresh: vi.fn(),
  request: { language: undefined as string | undefined },
}));

vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (name: string) =>
      name === "cl4n_lang" && request.language !== undefined
        ? { value: request.language }
        : undefined,
  }),
}));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh }),
}));
vi.mock("@/infrastructure/db/repositories/postgres-event-repository", () => ({
  postgresEventRepository: { getPublicEventBySlug },
}));
vi.mock("@/infrastructure/db/repositories/postgres-event-clue-repository", () => ({
  postgresEventClueRepository: { listForSlug },
}));

import CluesPage, { dynamic, generateMetadata, metadata } from "@/app/pistas/[slug]/page";

const startsAt = new Date("2026-11-21T01:30:00Z");
const clues: EventClue[] = [
  { id: "clue-1", body: "Primera pista", createdAt: new Date("2026-10-28T20:00:00Z"), images: [] },
  { id: "clue-2", body: "Segunda pista", createdAt: new Date("2026-10-28T21:00:00Z"), images: [] },
];

function publicEvent(phase: EventPhase) {
  return { slug: "cena-privada", startsAt, opensAt: startsAt, phase, maxPartySize: 4 };
}

function loadEvent(phase: EventPhase | null, storedClues: EventClue[] = []) {
  getPublicEventBySlug.mockResolvedValue({
    databaseTime: new Date(),
    value: phase ? publicEvent(phase) : null,
  });
  listForSlug.mockResolvedValue(storedClues);
}

function pageElement() {
  return CluesPage({ params: Promise.resolve({ slug: "cena-privada" }) });
}

async function resolvePublicShell(node: ReactNode): Promise<ReactNode> {
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (node.type === PublicHeader) {
    return resolvePublicShell(
      await PublicHeader(node.props as ComponentProps<typeof PublicHeader>),
    );
  }
  const children = await Promise.all(Children.toArray(node.props.children).map(resolvePublicShell));
  return children.length ? cloneElement(node, undefined, ...children) : node;
}

beforeEach(() => {
  vi.useFakeTimers();
  getPublicEventBySlug.mockReset();
  listForSlug.mockReset();
  refresh.mockReset();
  request.language = undefined;
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("clues page", () => {
  it("is rendered per request and hidden from search engines", () => {
    expect(dynamic).toBe("force-dynamic");
    expect(metadata).toEqual({
      title: "Pistas · Clandestino",
      robots: { index: false, follow: false },
    });
  });

  it.each([null, "DRAFT", "CANCELLED"] as const)("is not found for %s", async (phase) => {
    loadEvent(phase);

    await expect(pageElement()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(listForSlug).not.toHaveBeenCalled();
  });

  it("introduces the experience and keeps the clues page out of the header", async () => {
    loadEvent("CLOSED");
    const { container } = render(await resolvePublicShell(await pageElement()));

    expect(screen.getByText("CLANDESTINO SUPPER CLAN")).toBeDefined();
    expect(screen.getByRole("heading", { level: 1, name: "Pistas" })).toBeDefined();
    expect(container.querySelector(".clues-date")?.textContent).toBe(
      formatPublicEventDate(startsAt),
    );
    expect(screen.getByRole("link", { name: "Inicio" }).getAttribute("href")).toBe("/");
    expect(container.querySelector('a[href^="/pistas"]')).toBeNull();
  });

  it.each(["SCHEDULED", "OPEN", "WAITLIST", "FULL"] as const)(
    "does not show clues yet while the experience is %s",
    async (phase) => {
      loadEvent(phase, clues);
      render(await resolvePublicShell(await pageElement()));

      expect(
        screen.getByText("Las pistas aparecerán aquí cuando comience la experiencia."),
      ).toBeDefined();
      expect(screen.queryByText("Primera pista")).toBeNull();
      expect(listForSlug).not.toHaveBeenCalled();

      act(() => vi.advanceTimersByTime(60_000));
      expect(refresh).not.toHaveBeenCalled();
    },
  );

  it("lists the newest clue first and refreshes itself every 30 seconds while closed", async () => {
    loadEvent("CLOSED", [
      { ...clues[0]!, images: [{ id: "image-1" }, { id: "image-2" }] },
      clues[1]!,
    ]);
    const { container } = render(await resolvePublicShell(await pageElement()));

    const items = Array.from(container.querySelectorAll(".clues-list > li"));
    expect(items.map((item) => item.querySelector(".clue-label")?.textContent)).toEqual([
      "PISTA 2",
      "PISTA 1",
    ]);
    expect(items.map((item) => item.querySelector(".clue-body")?.textContent)).toEqual([
      "Segunda pista",
      "Primera pista",
    ]);
    expect(container.querySelector("ol.clues-list")).not.toBeNull();
    const image = screen.getByAltText("Imagen 1 adjunta a la pista 1");
    expect(image.getAttribute("src")).toBe("/pistas/cena-privada/imagenes/image-1");
    expect(screen.getAllByRole("img")).toHaveLength(2);
    expect(listForSlug).toHaveBeenCalledWith("cena-privada");

    act(() => vi.advanceTimersByTime(30_000));
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("asks the diners to stay alert when a closed experience has no clues", async () => {
    loadEvent("CLOSED");
    render(await resolvePublicShell(await pageElement()));

    expect(screen.getByText("Todavía no hay pistas. Mantente atento.")).toBeDefined();
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("keeps the clues visible without refreshing once the experience is completed", async () => {
    loadEvent("COMPLETED", clues);
    render(await resolvePublicShell(await pageElement()));

    expect(screen.getAllByRole("listitem")).toHaveLength(2);
    expect(screen.getByText("Segunda pista")).toBeDefined();

    act(() => vi.advanceTimersByTime(60_000));
    expect(refresh).not.toHaveBeenCalled();
  });

  it("renders English labels and metadata while preserving clue content", async () => {
    request.language = "en";
    loadEvent("CLOSED", [{ ...clues[0]!, images: [{ id: "image-1" }] }]);
    const { container } = render(await resolvePublicShell(await pageElement()));

    expect(screen.getByRole("heading", { level: 1, name: "Clues" })).toBeDefined();
    expect(container.querySelector(".clues-date")?.textContent).toBe(
      formatPublicEventDate(startsAt, "en"),
    );
    expect(screen.getByRole("link", { name: "Home" }).getAttribute("href")).toBe("/");
    expect(screen.getByText("CLUE 1")).toBeDefined();
    expect(screen.getByText("Primera pista")).toBeDefined();
    expect(screen.getByAltText("Image 1 attached to clue 1").getAttribute("src")).toBe(
      "/pistas/cena-privada/imagenes/image-1",
    );
    expect(await generateMetadata()).toEqual({
      title: "Clues · Clandestino",
      robots: { index: false, follow: false },
    });
  });
});
