// @vitest-environment jsdom

import type { ComponentProps } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import type { AdminActionState } from "@/app/admin/(protected)/events/actions";
import { GuestRequestForm } from "@/ui/admin/guests/guest-request-form";

type Action = (state: AdminActionState, formData: FormData) => Promise<AdminActionState>;

beforeAll(() => {
  global.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(cleanup);

function savingAction() {
  return vi.fn<Action>(async () => ({ ok: true, message: "Guardado." }));
}

function renderForm(
  action: Action = savingAction(),
  props: Partial<ComponentProps<typeof GuestRequestForm>> = {},
) {
  const view = render(
    <GuestRequestForm action={action} submitLabel="Agregar invitado" {...props} />,
  );
  return { ...view, form: view.container.querySelector("form")! };
}

function field(container: HTMLElement, name: string) {
  return container.querySelector<HTMLInputElement | HTMLTextAreaElement>(
    `input[id$="-${name}"]:not([aria-hidden]), textarea[name="${name}"]`,
  );
}

function typeInto(container: HTMLElement, name: string, value: string) {
  fireEvent.change(field(container, name)!, { target: { value } });
}

function choose(name: string) {
  fireEvent.click(screen.getByRole("radio", { name }));
}

function isChecked(name: string) {
  return screen.getByRole("radio", { name }).getAttribute("aria-checked") === "true";
}

async function postedFields(
  action: ReturnType<typeof savingAction>,
): Promise<Record<string, unknown>> {
  await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  const data = action.mock.calls[0]![1];
  return {
    ...Object.fromEntries(data.entries()),
    guestName: data.getAll("guestName"),
    guestInstagram: data.getAll("guestInstagram"),
  };
}

describe("GuestRequestForm party size", () => {
  it("starts as one person with only the first guest and the submit label", () => {
    const { container } = renderForm();

    expect(isChecked("Solo")).toBe(true);
    expect(isChecked("En pareja")).toBe(false);
    expect(screen.getByLabelText("Nombre completo")).toBeDefined();
    expect(screen.getByLabelText("Usuario de Instagram")).toBeDefined();
    expect(field(container, "guest2Name")).toBeNull();
    expect(field(container, "guest2Instagram")).toBeNull();
    expect(screen.getByRole("button", { name: "Agregar invitado" })).toBeDefined();
  });

  it("shows the second guest and numbers both people when switching to a couple", () => {
    const { container } = renderForm();

    choose("En pareja");

    expect(isChecked("En pareja")).toBe(true);
    expect(screen.getByLabelText("Persona 1: nombre completo")).toBeDefined();
    expect(screen.getByLabelText("Persona 1: usuario de Instagram")).toBeDefined();
    expect(screen.getByLabelText("Persona 2: nombre completo")).toBeDefined();
    expect(screen.getByLabelText("Persona 2: usuario de Instagram")).toBeDefined();
    expect(field(container, "guest2Name")).not.toBeNull();
    expect(field(container, "guest2Instagram")).not.toBeNull();
    expect(screen.queryByLabelText("Nombre completo")).toBeNull();
  });

  it("hides the second guest again when switching back to one person", () => {
    const { container } = renderForm();
    choose("En pareja");

    choose("Solo");

    expect(field(container, "guest2Name")).toBeNull();
    expect(field(container, "guest2Instagram")).toBeNull();
    expect(screen.getByLabelText("Nombre completo")).toBeDefined();
  });

  it("keeps what was typed for the first guest while switching the party", () => {
    const { container } = renderForm();
    typeInto(container, "guest1Name", "Ana López");
    typeInto(container, "guest1Instagram", "ana.lopez");

    choose("En pareja");
    choose("Solo");

    expect(field(container, "guest1Name")!.value).toBe("Ana López");
    expect(field(container, "guest1Instagram")!.value).toBe("ana.lopez");
  });

  it("hides the party control and posts a party of one when couples are not allowed", async () => {
    const action = savingAction();
    const { container, form } = renderForm(action, {
      allowCouple: false,
      defaultValues: { partySize: 2 },
    });

    expect(screen.queryByRole("radio", { name: "Solo" })).toBeNull();
    expect(screen.queryByRole("radio", { name: "En pareja" })).toBeNull();
    expect(field(container, "guest2Name")).toBeNull();
    const partySize = container.querySelector<HTMLInputElement>(
      'input[type="hidden"][name="partySize"]',
    );
    expect(partySize?.value).toBe("1");

    typeInto(container, "guest1Name", "Ana López");
    typeInto(container, "guest1Instagram", "ana.lopez");
    choose("No");
    fireEvent.submit(form);

    expect((await postedFields(action)).partySize).toBe("1");
  });
});

describe("GuestRequestForm allergies", () => {
  it("asks for one person and hides the detail field until the answer is yes", () => {
    const { container } = renderForm();

    expect(screen.getByRole("group", { name: "¿Tiene alergias?" })).toBeDefined();
    expect(screen.getByRole("radiogroup", { name: "¿Tiene alergias?" })).toBeDefined();
    expect(field(container, "allergies")).toBeNull();

    choose("Sí");
    expect(screen.getByLabelText("¿A qué?")).toBe(field(container, "allergies"));

    choose("No");
    expect(field(container, "allergies")).toBeNull();
  });

  it("starts without an answer so the admin has to choose", () => {
    renderForm();

    expect(isChecked("No")).toBe(false);
    expect(isChecked("Sí")).toBe(false);
  });

  it("switches the legend and the detail label with the party", () => {
    renderForm();
    choose("Sí");

    choose("En pareja");
    expect(screen.getByRole("group", { name: "¿Alguno de los dos tiene alergias?" })).toBeDefined();
    expect(screen.getByLabelText("¿Quién y a qué?")).toBeDefined();
    expect(screen.queryByLabelText("¿A qué?")).toBeNull();

    choose("Solo");
    expect(screen.getByRole("group", { name: "¿Tiene alergias?" })).toBeDefined();
    expect(screen.getByLabelText("¿A qué?")).toBeDefined();
    expect(screen.queryByLabelText("¿Quién y a qué?")).toBeNull();
  });
});

describe("GuestRequestForm defaults", () => {
  it("pre-fills a couple with allergies", () => {
    const { container } = renderForm(savingAction(), {
      submitLabel: "Guardar cambios",
      defaultValues: {
        partySize: 2,
        guest1Name: "Ana López",
        guest1Instagram: "ana.lopez",
        guest2Name: "Luis Pérez",
        guest2Instagram: "luis.perez",
        hasAllergies: true,
        allergies: "Ana: maní",
        notes: "Mesa tranquila",
      },
    });

    expect(isChecked("En pareja")).toBe(true);
    expect(isChecked("Sí")).toBe(true);
    expect(field(container, "guest1Name")!.value).toBe("Ana López");
    expect(field(container, "guest1Instagram")!.value).toBe("ana.lopez");
    expect(field(container, "guest2Name")!.value).toBe("Luis Pérez");
    expect(field(container, "guest2Instagram")!.value).toBe("luis.perez");
    expect(field(container, "allergies")!.value).toBe("Ana: maní");
    expect(field(container, "notes")!.value).toBe("Mesa tranquila");
  });

  it("pre-fills one person without allergies", () => {
    const { container } = renderForm(savingAction(), {
      defaultValues: { guest1Name: "Ana López", hasAllergies: false },
    });

    expect(isChecked("Solo")).toBe(true);
    expect(isChecked("No")).toBe(true);
    expect(field(container, "allergies")).toBeNull();
    expect(field(container, "guest1Name")!.value).toBe("Ana López");
  });
});

describe("GuestRequestForm submission", () => {
  it("posts the exact field names for a couple with allergies", async () => {
    const action = savingAction();
    const { container, form } = renderForm(action);

    choose("En pareja");
    typeInto(container, "guest1Name", "Ana López");
    typeInto(container, "guest1Instagram", "ana.lopez");
    typeInto(container, "guest2Name", "Luis Pérez");
    typeInto(container, "guest2Instagram", "luis.perez");
    choose("Sí");
    typeInto(container, "allergies", "Ana: maní");
    typeInto(container, "notes", "Mesa tranquila");
    fireEvent.submit(form);

    expect(await postedFields(action)).toEqual({
      partySize: "2",
      guestName: ["Ana López", "Luis Pérez"],
      guestInstagram: ["ana.lopez", "luis.perez"],
      hasAllergies: "true",
      allergies: "Ana: maní",
      notes: "Mesa tranquila",
    });
  });

  it("posts one person without the second guest or the allergy detail", async () => {
    const action = savingAction();
    const { container, form } = renderForm(action);

    choose("En pareja");
    typeInto(container, "guest2Name", "Luis Pérez");
    choose("Solo");
    typeInto(container, "guest1Name", "Ana López");
    typeInto(container, "guest1Instagram", "ana.lopez");
    choose("No");
    fireEvent.submit(form);

    expect(await postedFields(action)).toEqual({
      partySize: "1",
      guestName: ["Ana López"],
      guestInstagram: ["ana.lopez"],
      hasAllergies: "false",
      notes: "",
    });
  });

  it("does not post hasAllergies until the admin answers", async () => {
    const action = savingAction();
    const { form } = renderForm(action);

    fireEvent.submit(form);

    expect(Object.keys(await postedFields(action))).not.toContain("hasAllergies");
  });

  it("disables the submit button with a spinner while the action is running", async () => {
    let resolveAction: ((state: AdminActionState) => void) | undefined;
    const action = vi.fn<Action>(
      () =>
        new Promise<AdminActionState>((resolve) => {
          resolveAction = resolve;
        }),
    );
    const { container, form } = renderForm(action);

    fireEvent.submit(form);

    const pending = (await screen.findByRole("button", {
      name: "Guardando...",
    })) as HTMLButtonElement;
    expect(pending.disabled).toBe(true);
    expect(container.querySelector(".animate-spin")).not.toBeNull();

    resolveAction?.({ ok: true, message: "Guardado." });

    const idle = (await screen.findByRole("button", {
      name: "Agregar invitado",
    })) as HTMLButtonElement;
    expect(idle.disabled).toBe(false);
  });
});

describe("GuestRequestForm feedback", () => {
  it("shows a failure message in a destructive alert and keeps what was typed", async () => {
    const action = vi.fn<Action>(async () => ({ ok: false, message: "No se pudo guardar." }));
    const { container, form } = renderForm(action);
    typeInto(container, "guest1Name", "Ana López");
    choose("En pareja");
    choose("Sí");
    typeInto(container, "allergies", "Ana: maní");

    fireEvent.submit(form);

    const alert = await screen.findByRole("status");
    expect(alert.textContent).toBe("No se pudo guardar.");
    expect(alert.className).toContain("border-destructive");
    expect(field(container, "guest1Name")!.value).toBe("Ana López");
    expect(field(container, "allergies")!.value).toBe("Ana: maní");
    expect(isChecked("En pareja")).toBe(true);
    expect(isChecked("Sí")).toBe(true);
  });

  it("shows a success message in a success alert", async () => {
    const { form } = renderForm(savingAction());

    fireEvent.submit(form);

    const alert = await screen.findByRole("status");
    expect(alert.textContent).toBe("Guardado.");
    expect(alert.className).toContain("border-success");
  });

  it("shows no alert before anything is submitted", () => {
    renderForm();

    expect(screen.queryByRole("status")).toBeNull();
  });

  it("shows each field error, marks the fields invalid and focuses the first one", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: {
        "guests.0.name": "El nombre completo es obligatorio.",
        "guests.0.instagram": "El usuario de Instagram es obligatorio.",
        notes: "Las observaciones no pueden superar 500 caracteres.",
      },
    }));
    const { container, form } = renderForm(action);

    fireEvent.submit(form);

    for (const [name, message] of [
      ["guest1Name", "El nombre completo es obligatorio."],
      ["guest1Instagram", "El usuario de Instagram es obligatorio."],
      ["notes", "Las observaciones no pueden superar 500 caracteres."],
    ] as const) {
      const error = await screen.findByText(message);
      const input = field(container, name)!;
      expect(input.getAttribute("aria-invalid")).toBe("true");
      expect(input.getAttribute("aria-describedby")).toBe(error.id);
    }
    expect(screen.getByRole("status").textContent).toBe("Revisa los campos marcados.");
    await waitFor(() => expect(document.activeElement).toBe(field(container, "guest1Name")));
  });

  it("leaves valid fields unmarked", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { "guests.0.instagram": "El usuario de Instagram es obligatorio." },
    }));
    const { container, form } = renderForm(action);

    fireEvent.submit(form);

    await screen.findByText("El usuario de Instagram es obligatorio.");
    expect(field(container, "guest1Name")!.getAttribute("aria-invalid")).toBe("false");
    expect(field(container, "guest1Name")!.hasAttribute("aria-describedby")).toBe(false);
    await waitFor(() => expect(document.activeElement).toBe(field(container, "guest1Instagram")));
  });

  it("shows the second guest errors for a couple", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { "guests.1.name": "El nombre completo de la segunda persona es obligatorio." },
    }));
    const { container, form } = renderForm(action);
    choose("En pareja");

    fireEvent.submit(form);

    await screen.findByText("El nombre completo de la segunda persona es obligatorio.");
    expect(field(container, "guest2Name")!.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(field(container, "guest2Name")));
  });

  it("shows the allergy answer error and moves focus into that choice", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { hasAllergies: "Indica si tiene alergias." },
    }));
    const { form } = renderForm(action);

    fireEvent.submit(form);

    const error = await screen.findByText("Indica si tiene alergias.");
    const choice = screen.getByRole("radiogroup", { name: "¿Tiene alergias?" });
    expect(choice.getAttribute("aria-invalid")).toBe("true");
    expect(choice.getAttribute("aria-describedby")).toBe(error.id);
    await waitFor(() => expect(choice.contains(document.activeElement)).toBe(true));
  });

  it("shows the allergy detail error under the detail field", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: { allergies: "Cuéntanos a qué es alérgico." },
    }));
    const { container, form } = renderForm(action);
    choose("Sí");

    fireEvent.submit(form);

    await screen.findByText("Cuéntanos a qué es alérgico.");
    expect(field(container, "allergies")!.getAttribute("aria-invalid")).toBe("true");
    await waitFor(() => expect(document.activeElement).toBe(field(container, "allergies")));
  });
});

describe("GuestRequestForm groups (max >= 3)", () => {
  it("keeps the segmented 1/2 control unchanged when maxPartySize is 2", () => {
    renderForm(savingAction(), { maxPartySize: 2 });

    expect(isChecked("Solo")).toBe(true);
    expect(screen.getByRole("radio", { name: "En pareja" })).toBeDefined();
    expect(screen.queryByRole("button", { name: "Más personas" })).toBeNull();
  });

  it("shows the Personas stepper, adds up to 4 blocks, and posts 4 guestName values in order", async () => {
    const action = savingAction();
    const { container, form } = renderForm(action, { maxPartySize: 4 });

    const minus = screen.getByRole("button", { name: "Menos personas" }) as HTMLButtonElement;
    const plus = screen.getByRole("button", { name: "Más personas" }) as HTMLButtonElement;
    expect(minus.disabled).toBe(true);
    expect(plus.disabled).toBe(false);
    expect(screen.getByText("Persona 1 · Titular")).toBeDefined();
    expect(screen.queryByText("Persona 2")).toBeNull();

    fireEvent.click(plus);
    fireEvent.click(plus);
    fireEvent.click(plus);
    expect(plus.disabled).toBe(true);
    expect(screen.getByText("Persona 2")).toBeDefined();
    expect(screen.getByText("Persona 3")).toBeDefined();
    expect(screen.getByText("Persona 4")).toBeDefined();

    for (const [slot, name, instagram] of [
      [1, "Ana", "ana.ig"],
      [2, "Luis", "luis.ig"],
      [3, "Marta", "marta.ig"],
      [4, "Pedro", "pedro.ig"],
    ] as const) {
      typeInto(container, `guest${slot}Name`, name);
      typeInto(container, `guest${slot}Instagram`, instagram);
    }
    choose("No");
    fireEvent.submit(form);

    expect(await postedFields(action)).toEqual({
      partySize: "4",
      guestName: ["Ana", "Luis", "Marta", "Pedro"],
      guestInstagram: ["ana.ig", "luis.ig", "marta.ig", "pedro.ig"],
      hasAllergies: "false",
      notes: "",
    });
  });

  it("maps guests.{i}.* errors to the matching block", async () => {
    const action = vi.fn<Action>(async () => ({
      ok: false,
      message: "Revisa los campos marcados.",
      fieldErrors: {
        "guests.2.name": "El nombre de la persona 3 es obligatorio.",
        "guests.3.instagram": "El Instagram de la persona 4 es obligatorio.",
      },
    }));
    const { container, form } = renderForm(action, {
      maxPartySize: 4,
      defaultValues: { partySize: 4 },
    });

    fireEvent.submit(form);

    const nameError = await screen.findByText("El nombre de la persona 3 es obligatorio.");
    const igError = await screen.findByText("El Instagram de la persona 4 es obligatorio.");
    const guest3Name = field(container, "guest3Name")!;
    const guest4Ig = field(container, "guest4Instagram")!;

    expect(guest3Name.getAttribute("aria-invalid")).toBe("true");
    expect(guest3Name.getAttribute("aria-describedby")).toBe(nameError.id);
    expect(guest4Ig.getAttribute("aria-invalid")).toBe("true");
    expect(guest4Ig.getAttribute("aria-describedby")).toBe(igError.id);
    expect(field(container, "guest1Name")!.getAttribute("aria-invalid")).toBe("false");
  });

  it("pre-fills edit mode from guests[]", () => {
    const { container } = renderForm(savingAction(), {
      maxPartySize: 4,
      defaultValues: {
        partySize: 3,
        guests: [
          { name: "Ana", instagram: "ana.ig" },
          { name: "Luis", instagram: "luis.ig" },
          { name: "Marta", instagram: "marta.ig" },
        ],
        hasAllergies: true,
        allergies: "Marta: gluten",
        notes: "Cumpleaños",
      },
    });

    expect(field(container, "guest1Name")!.value).toBe("Ana");
    expect(field(container, "guest2Name")!.value).toBe("Luis");
    expect(field(container, "guest3Name")!.value).toBe("Marta");
    expect(field(container, "guest3Instagram")!.value).toBe("marta.ig");
    expect(field(container, " guest4Name")).toBeNull();
    expect(screen.getByRole("group", { name: "¿Alguno tiene alergias?" })).toBeDefined();
  });
});
