import { randomUUID } from "node:crypto";

import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({ token: "stale-session-token" }));

vi.mock("next/headers", () => ({
  cookies: vi.fn(async () => ({
    get: vi.fn(() => ({ value: authState.token })),
  })),
}));

vi.mock("next/navigation", () => ({
  notFound: vi.fn(() => {
    throw new Error("NOT_FOUND");
  }),
  redirect: vi.fn((destination: string) => {
    throw new Error(`REDIRECT:${destination}`);
  }),
}));

import ProtectedAdminLayout from "@/app/admin/(protected)/layout";
import AdminPage from "@/app/admin/(protected)/page";
import AuditPage from "@/app/admin/(protected)/audit/page";
import EditEventPage from "@/app/admin/(protected)/events/[id]/edit/page";
import EventDetailPage from "@/app/admin/(protected)/events/[id]/page";
import NewEventPage from "@/app/admin/(protected)/events/new/page";

import { resetTestDatabase } from "../helpers/test-db";

let pool: Pool;

beforeAll(async () => {
  await resetTestDatabase();
  pool = (await import("@/infrastructure/db/client")).pool;
});

afterAll(async () => {
  await pool.end();
});

describe("protected admin pages", () => {
  it.each([
    ["layout", () => ProtectedAdminLayout({ children: null })],
    ["dashboard", () => AdminPage()],
    ["audit", () => AuditPage({ searchParams: Promise.resolve({}) })],
    ["new event", () => NewEventPage()],
    [
      "event detail",
      () =>
        EventDetailPage({
          params: Promise.resolve({ id: randomUUID() }),
          searchParams: Promise.resolve({}),
        }),
    ],
    ["event edit", () => EditEventPage({ params: Promise.resolve({ id: randomUUID() }) })],
  ])("redirects %s to login when the cookie has no database session", async (_name, render) => {
    await expect(render()).rejects.toThrow("REDIRECT:/admin/login");
  });
});
