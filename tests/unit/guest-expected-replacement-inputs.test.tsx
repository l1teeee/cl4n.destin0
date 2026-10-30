// @vitest-environment jsdom

import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";

import { ExpectedReplacementInputs } from "@/ui/admin/guests/expected-replacement-inputs";

afterEach(cleanup);

const firstId = "00000000-0000-4000-8000-000000000001";
const secondId = "00000000-0000-4000-8000-000000000002";

describe("ExpectedReplacementInputs", () => {
  it("renders one hidden input per id with the expectedPromotedEntryIds name", () => {
    const { container } = render(
      <form>
        <ExpectedReplacementInputs entryIds={[firstId, secondId]} />
      </form>,
    );

    const inputs = Array.from(container.querySelectorAll("input"));
    expect(inputs).toHaveLength(2);
    for (const input of inputs) {
      expect(input.getAttribute("type")).toBe("hidden");
      expect(input.getAttribute("name")).toBe("expectedPromotedEntryIds");
    }
  });

  it("keeps the order of the ids", () => {
    const { container } = render(
      <form>
        <ExpectedReplacementInputs entryIds={[secondId, firstId]} />
      </form>,
    );

    const values = Array.from(container.querySelectorAll("input")).map((input) => input.value);
    expect(values).toEqual([secondId, firstId]);
  });

  it("posts the ids in order inside a form", () => {
    const { container } = render(
      <form>
        <ExpectedReplacementInputs entryIds={[firstId, secondId]} />
      </form>,
    );

    const formData = new FormData(container.querySelector("form")!);
    expect(formData.getAll("expectedPromotedEntryIds")).toEqual([firstId, secondId]);
  });

  it("renders nothing when nobody is expected to come in", () => {
    const { container } = render(
      <form>
        <ExpectedReplacementInputs entryIds={[]} />
      </form>,
    );

    expect(container.querySelector("input")).toBeNull();
    expect(new FormData(container.querySelector("form")!).has("expectedPromotedEntryIds")).toBe(
      false,
    );
  });
});
