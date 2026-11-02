// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { Children, cloneElement, isValidElement, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ClosedState } from "@/ui/public/closed-state";
import { PublicFooter } from "@/ui/public/public-footer";
import { PublicHeader } from "@/ui/public/public-header";
import { PublicLanding } from "@/ui/public/public-landing";

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

async function resolvePublicShell(node: ReactNode): Promise<ReactNode> {
  if (!isValidElement<{ children?: ReactNode }>(node)) return node;
  if (node.type === PublicHeader) {
    return resolvePublicShell(
      await PublicHeader(node.props as ComponentProps<typeof PublicHeader>),
    );
  }
  if (node.type === PublicFooter) {
    return resolvePublicShell(PublicFooter(node.props as ComponentProps<typeof PublicFooter>));
  }
  if (node.type === PublicLanding) {
    return resolvePublicShell(
      await PublicLanding(node.props as ComponentProps<typeof PublicLanding>),
    );
  }
  const children = await Promise.all(Children.toArray(node.props.children).map(resolvePublicShell));
  return children.length ? cloneElement(node, undefined, ...children) : node;
}

beforeEach(() => {
  request.language = undefined;
  request.refresh.mockClear();
});

afterEach(cleanup);

describe("ClosedState", () => {
  it.each([
    [
      { state: "SCHEDULED", opensAt: new Date("2026-11-20T18:00:00.000Z") } as const,
      "La próxima experiencia ya tiene fecha. Las solicitudes abren el Viernes 20 de noviembre, 12:00 p. m.",
    ],
    [{ state: "FULL" } as const, "Los cupos para esta experiencia se agotaron."],
    [{ state: "CLOSED" } as const, "Las solicitudes para esta experiencia ya cerraron."],
    [{ state: "DEFAULT" } as const, "Todavía no hay fecha. Cuando la haya, lo sabrás."],
  ])("renders the %s copy", async (variant, copy) => {
    render(await resolvePublicShell(await ClosedState({ variant })));

    expect(screen.getByRole("heading", { name: "EL CLAN ESTÁ CERRADO" })).toBeDefined();
    expect(screen.getByText(copy)).toBeDefined();
  });

  it("renders the scheduled opening in English and El Salvador time", async () => {
    request.language = "en";
    const variant = {
      state: "SCHEDULED",
      opensAt: new Date("2026-11-20T18:00:00.000Z"),
    } as const;
    render(await resolvePublicShell(await ClosedState({ variant })));

    expect(screen.getByRole("heading", { name: "THE CLAN IS CLOSED" })).toBeDefined();
    expect(
      screen.getByText(
        "The next experience has a date. Requests open on Friday, November 20, 12:00 PM",
      ),
    ).toBeDefined();
  });
});
