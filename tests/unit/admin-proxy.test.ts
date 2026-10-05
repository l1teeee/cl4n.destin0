import { NextRequest } from "next/server";
import { describe, expect, it } from "vitest";

import { proxy } from "@/proxy";

describe("admin proxy", () => {
  it("redirects /admin without a session cookie", () => {
    const response = proxy(new NextRequest("http://localhost/admin"));
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe("http://localhost/admin/login");
  });

  it("allows the login page without a session cookie", () => {
    const response = proxy(new NextRequest("http://localhost/admin/login"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it.each(["cl4n_session", "__Host-cl4n_session"])("optimistically allows %s", (name) => {
    const request = new NextRequest("http://localhost/admin/events", {
      headers: { cookie: `${name}=opaque-token` },
    });
    const response = proxy(request);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
});
