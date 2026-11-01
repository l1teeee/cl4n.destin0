// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { ConversationControls } from "@/ui/admin/messages/conversation-controls";
import { LinkByCodeForm } from "@/ui/admin/messages/link-by-code-form";

afterEach(cleanup);

describe("LinkByCodeForm", () => {
  it("submits the contact id and code to the supplied action", async () => {
    const action = vi.fn(
      async (_contactId: string, _state: AdminActionState, _formData: FormData) => {
        void _contactId;
        void _state;
        void _formData;
        return { ok: true, message: "Vinculada." };
      },
    );
    render(<LinkByCodeForm contactId="contact-1" action={action} />);

    fireEvent.change(screen.getByRole("textbox", { name: "Código de solicitud" }), {
      target: { value: "AB23CD" },
    });
    fireEvent.submit(screen.getByRole("button", { name: "Vincular" }).closest("form")!);

    await waitFor(() => expect(action).toHaveBeenCalledOnce());
    expect(action.mock.calls[0]![0]).toBe("contact-1");
    expect((action.mock.calls[0]![2] as FormData).get("code")).toBe("AB23CD");
    expect(await screen.findByText("Vinculada.")).toBeDefined();
  });

  it("is present in the conversation controls used by the page", () => {
    const action = vi.fn(
      async (_contactId: string, _state: AdminActionState, _formData: FormData) => {
        void _contactId;
        void _state;
        void _formData;
        return { ok: true, message: "" };
      },
    );
    render(
      <ConversationControls
        contactId="contact-1"
        linkedRequests={[]}
        linkByCodeAction={action}
        unlinkAction={action}
      />,
    );

    expect(screen.getByText("Vincular por código")).toBeDefined();
    expect(screen.getByRole("textbox", { name: "Código de solicitud" })).toBeDefined();
  });
});
