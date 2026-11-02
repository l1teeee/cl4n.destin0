import { describe, expect, it } from "vitest";

import { instagramConnectionNotices } from "@/ui/admin/messages/instagram-connection-notices";

describe("instagramConnectionNotices", () => {
  it("is an array containing wrong_account", () => {
    expect(Array.isArray(instagramConnectionNotices)).toBe(true);
    expect(instagramConnectionNotices).toContain("wrong_account");
  });
});
