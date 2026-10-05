import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import GlobalError from "@/app/global-error";

describe("global error boundary", () => {
  it("renders no internal error details", () => {
    const error = Object.assign(new Error("secret SQL constraint and internal id"), {
      digest: "internal-digest",
    });
    error.stack = "sensitive stack trace";

    const html = renderToStaticMarkup(createElement(GlobalError, { error }));

    expect(html).toContain("Ocurrio un error inesperado.");
    expect(html).not.toContain(error.message);
    expect(html).not.toContain(error.stack);
    expect(html).not.toContain(error.digest);
  });
});
