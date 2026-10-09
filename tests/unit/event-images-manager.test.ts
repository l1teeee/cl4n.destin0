import { describe, expect, it } from "vitest";

import { createUploadId, uploadErrorMessage } from "@/ui/admin/event-images-manager";

describe("event image upload helpers", () => {
  it("uses the fallback message for non-JSON error responses", async () => {
    const response = new Response("Payload Too Large", {
      status: 413,
      headers: { "Content-Type": "text/html" },
    });
    await expect(uploadErrorMessage(response)).resolves.toBe("No se pudo subir la imagen.");
  });

  it("gives duplicate file uploads distinct ids", () => {
    const first = createUploadId();
    const second = createUploadId();
    expect(first).not.toBe(second);
  });
});
