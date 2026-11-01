import { describe, expect, it } from "vitest";

import {
  acceptedResult,
  addedResult,
  cancelPaidConfirmation,
  cancelUnpaidConfirmation,
  cancelledResult,
  enteredFromQueueSentence,
  guestsLabel,
  messageOutcomeSentence,
  partySizeLabel,
  paymentVerifiedResult,
  promotedFromQueueResult,
  refundedResult,
  rejectConfirmation,
  rejectedResult,
  removedFromQueueResult,
  replacementSentence,
  type MessageOutcome,
} from "@/ui/admin/guests/guest-copy";

const solo = ["Ana López"];
const couple = ["Ana López", "Luis Pérez"];

const noQueue = "No hay nadie en la cola, así que el lugar quedará libre.";
const oneInQueue = "Se va a agregar a Carla, que es la primera en la cola.";
const twoInQueue = "Se van a agregar a Carla y a Pedro, que son los primeros en la cola.";

describe("guestsLabel", () => {
  it("returns the single name", () => {
    expect(guestsLabel(solo)).toBe("Ana López");
  });

  it("joins a couple with y", () => {
    expect(guestsLabel(couple)).toBe("Ana López y Luis Pérez");
  });
});

describe("partySizeLabel", () => {
  it("uses the singular for one person", () => {
    expect(partySizeLabel(1)).toBe("1 persona");
  });

  it("uses the plural for two people", () => {
    expect(partySizeLabel(2)).toBe("2 personas");
  });
});

describe("replacementSentence", () => {
  it("says the seat stays free when nobody is in the queue", () => {
    expect(replacementSentence([])).toBe(noQueue);
  });

  it("names the single request that comes in", () => {
    expect(replacementSentence(["Carla"])).toBe(oneInQueue);
  });

  it("names both requests that come in", () => {
    expect(replacementSentence(["Carla", "Pedro"])).toBe(twoInQueue);
  });

  it("keeps a couple request as one name", () => {
    expect(replacementSentence(["Carla y Mario"])).toBe(
      "Se va a agregar a Carla y Mario, que es la primera en la cola.",
    );
  });
});

describe("rejectConfirmation", () => {
  it.each([
    {
      case: "one guest and an empty queue",
      guests: solo,
      replacements: [],
      expected: `Al rechazar a Ana López va a quedar un espacio vacío. ${noQueue} ¿Estás seguro?`,
    },
    {
      case: "a couple and one replacement",
      guests: couple,
      replacements: ["Carla"],
      expected: `Al rechazar a Ana López y Luis Pérez va a quedar un espacio vacío. ${oneInQueue} ¿Estás seguro?`,
    },
    {
      case: "one guest and two replacements",
      guests: solo,
      replacements: ["Carla", "Pedro"],
      expected: `Al rechazar a Ana López va a quedar un espacio vacío. ${twoInQueue} ¿Estás seguro?`,
    },
  ])("words $case", ({ guests, replacements, expected }) => {
    expect(rejectConfirmation({ guests, replacements })).toBe(expected);
  });
});

describe("cancelUnpaidConfirmation", () => {
  it.each([
    {
      case: "one guest and an empty queue",
      guests: solo,
      replacements: [],
      expected: `Al eliminar a Ana López de la lista va a quedar un espacio vacío. ${noQueue} ¿Estás seguro?`,
    },
    {
      case: "a couple and one replacement",
      guests: couple,
      replacements: ["Carla"],
      expected: `Al eliminar a Ana López y Luis Pérez de la lista va a quedar un espacio vacío. ${oneInQueue} ¿Estás seguro?`,
    },
    {
      case: "one guest and two replacements",
      guests: solo,
      replacements: ["Carla", "Pedro"],
      expected: `Al eliminar a Ana López de la lista va a quedar un espacio vacío. ${twoInQueue} ¿Estás seguro?`,
    },
  ])("words $case", ({ guests, replacements, expected }) => {
    expect(cancelUnpaidConfirmation({ guests, replacements })).toBe(expected);
  });
});

describe("cancelPaidConfirmation", () => {
  const lead =
    "Se le enviará un mensaje lamentando la cancelación y quedará pendiente el reembolso. Va a quedar un espacio vacío.";
  const newcomerNote = "Quien entre tendrá que pasar por todo el proceso: revisión, lista y pago.";

  it.each([
    {
      case: "one guest with one replacement",
      guests: solo,
      replacements: ["Carla"],
      expected: `Ana López ya pagó. ${lead} ${oneInQueue} ${newcomerNote} ¿Estás seguro?`,
    },
    {
      case: "a couple with two replacements",
      guests: couple,
      replacements: ["Carla", "Pedro"],
      expected: `Ana López y Luis Pérez ya pagaron. ${lead} ${twoInQueue} ${newcomerNote} ¿Estás seguro?`,
    },
  ])("adds the process note for $case", ({ guests, replacements, expected }) => {
    expect(cancelPaidConfirmation({ guests, replacements })).toBe(expected);
  });

  it.each([
    {
      case: "one guest",
      guests: solo,
      expected: `Ana López ya pagó. ${lead} ${noQueue} ¿Estás seguro?`,
    },
    {
      case: "a couple",
      guests: couple,
      expected: `Ana López y Luis Pérez ya pagaron. ${lead} ${noQueue} ¿Estás seguro?`,
    },
  ])("omits the process note when nobody is in the queue for $case", ({ guests, expected }) => {
    const text = cancelPaidConfirmation({ guests, replacements: [] });

    expect(text).toBe(expected);
    expect(text).not.toContain("Quien entre");
  });
});

describe("messageOutcomeSentence", () => {
  it.each<[MessageOutcome, string]>([
    ["SENT", "Mensaje enviado por Instagram."],
    ["QUEUED", "El mensaje se está enviando."],
    ["WAITING_CONTACT", "El mensaje quedó pendiente: todavía no nos ha escrito por Instagram."],
    [
      "WAITING_WINDOW",
      "El mensaje quedó pendiente: se enviará cuando vuelva a escribir por Instagram.",
    ],
    ["FAILED", "No se pudo enviar el mensaje; puedes reintentarlo desde Mensajes."],
    ["NOT_SENT", ""],
  ])("describes %s", (outcome, expected) => {
    expect(messageOutcomeSentence(outcome)).toBe(expected);
  });
});

describe("acceptedResult", () => {
  it("uses the singular and omits the empty outcome", () => {
    expect(acceptedResult({ guests: solo, outcome: "NOT_SENT" })).toBe(
      "Aceptaste a Ana López. Ya está en la lista.",
    );
  });

  it("uses the plural and appends the outcome after a space", () => {
    expect(acceptedResult({ guests: couple, outcome: "SENT" })).toBe(
      "Aceptaste a Ana López y Luis Pérez. Ya están en la lista. Mensaje enviado por Instagram.",
    );
  });
});

describe("paymentVerifiedResult", () => {
  it("uses the singular", () => {
    expect(paymentVerifiedResult({ guests: solo, outcome: "NOT_SENT" })).toBe(
      "Pago verificado: Ana López quedó confirmado.",
    );
  });

  it("uses the plural and appends the outcome", () => {
    expect(paymentVerifiedResult({ guests: couple, outcome: "QUEUED" })).toBe(
      "Pago verificado: Ana López y Luis Pérez quedaron confirmados. El mensaje se está enviando.",
    );
  });
});

describe("rejectedResult", () => {
  it("states only the rejection when nobody was promoted", () => {
    expect(rejectedResult({ guests: solo, promoted: [], outcome: "NOT_SENT" })).toBe(
      "Se rechazó a Ana López.",
    );
  });

  it("names a single promoted request", () => {
    expect(rejectedResult({ guests: solo, promoted: ["Carla"], outcome: "SENT" })).toBe(
      "Se rechazó a Ana López. Se agregó a Carla a la lista para revisión. Mensaje enviado por Instagram.",
    );
  });

  it("joins several promoted requests with y a", () => {
    expect(
      rejectedResult({
        guests: couple,
        promoted: ["Carla", "Pedro"],
        outcome: "WAITING_CONTACT",
      }),
    ).toBe(
      "Se rechazó a Ana López y Luis Pérez. Se agregó a Carla y a Pedro a la lista para revisión. El mensaje quedó pendiente: todavía no nos ha escrito por Instagram.",
    );
  });
});

describe("cancelledResult", () => {
  it("states only the cancellation when nobody was promoted and nothing is owed", () => {
    expect(
      cancelledResult({ guests: solo, promoted: [], refundPending: false, outcome: "NOT_SENT" }),
    ).toBe("Se canceló a Ana López correctamente.");
  });

  it("adds the pending refund after the promoted sentence and before the outcome", () => {
    expect(
      cancelledResult({
        guests: solo,
        promoted: ["Carla"],
        refundPending: true,
        outcome: "FAILED",
      }),
    ).toBe(
      "Se canceló a Ana López correctamente. Se agregó a Carla a la lista para revisión. Reembolso pendiente. No se pudo enviar el mensaje; puedes reintentarlo desde Mensajes.",
    );
  });

  it("adds the pending refund without promoted requests for a couple", () => {
    expect(
      cancelledResult({ guests: couple, promoted: [], refundPending: true, outcome: "NOT_SENT" }),
    ).toBe("Se canceló a Ana López y Luis Pérez correctamente. Reembolso pendiente.");
  });

  it("omits the refund sentence when nothing is owed but keeps the promoted request", () => {
    expect(
      cancelledResult({
        guests: couple,
        promoted: ["Carla", "Pedro"],
        refundPending: false,
        outcome: "WAITING_WINDOW",
      }),
    ).toBe(
      "Se canceló a Ana López y Luis Pérez correctamente. Se agregó a Carla y a Pedro a la lista para revisión. El mensaje quedó pendiente: se enviará cuando vuelva a escribir por Instagram.",
    );
  });
});

describe("refundedResult", () => {
  it("names the refunded guests", () => {
    expect(refundedResult({ guests: couple, outcome: "NOT_SENT" })).toBe(
      "Reembolso registrado para Ana López y Luis Pérez.",
    );
  });

  it("appends the outcome", () => {
    expect(refundedResult({ guests: solo, outcome: "SENT" })).toBe(
      "Reembolso registrado para Ana López. Mensaje enviado por Instagram.",
    );
  });
});

describe("promotedFromQueueResult", () => {
  it("uses the singular", () => {
    expect(promotedFromQueueResult({ guests: solo, outcome: "NOT_SENT" })).toBe(
      "Ana López pasó de la cola a la lista para revisión.",
    );
  });

  it("uses the plural and appends the outcome", () => {
    expect(promotedFromQueueResult({ guests: couple, outcome: "WAITING_WINDOW" })).toBe(
      "Ana López y Luis Pérez pasaron de la cola a la lista para revisión. El mensaje quedó pendiente: se enviará cuando vuelva a escribir por Instagram.",
    );
  });
});

describe("removedFromQueueResult", () => {
  it("names the removed guests", () => {
    expect(removedFromQueueResult({ guests: solo, promoted: [], outcome: "NOT_SENT" })).toBe(
      "Se quitó a Ana López de la cola.",
    );
  });

  it("names a couple and appends the outcome", () => {
    expect(removedFromQueueResult({ guests: couple, promoted: [], outcome: "SENT" })).toBe(
      "Se quitó a Ana López y Luis Pérez de la cola. Mensaje enviado por Instagram.",
    );
  });

  it("names who entered before the outcome", () => {
    expect(removedFromQueueResult({ guests: solo, promoted: ["Carla"], outcome: "QUEUED" })).toBe(
      "Se quitó a Ana López de la cola. Entró Carla desde la cola. El mensaje se está enviando.",
    );
  });
});

describe("enteredFromQueueSentence", () => {
  it("is empty when nobody entered", () => {
    expect(enteredFromQueueSentence([])).toBe("");
  });

  it("starts with a space so it can follow another sentence", () => {
    expect(enteredFromQueueSentence(["Carla"])).toBe(" Entró Carla desde la cola.");
  });

  it("joins several entries with y", () => {
    expect(enteredFromQueueSentence(["Carla", "Pedro"])).toBe(
      " Entró Carla y Pedro desde la cola.",
    );
  });
});

describe("addedResult", () => {
  it("says the guests went to the review list", () => {
    expect(addedResult({ guests: solo, placement: "LIST", position: null })).toBe(
      "Se agregó a Ana López a la lista para revisión.",
    );
  });

  it("does not need a position for the review list", () => {
    expect(addedResult({ guests: couple, placement: "LIST" })).toBe(
      "Se agregó a Ana López y Luis Pérez a la lista para revisión.",
    );
  });

  it("gives the queue position of one guest", () => {
    expect(addedResult({ guests: solo, placement: "QUEUE", position: 3 })).toBe(
      "No había lugar: Ana López quedó en la cola en la posición 3.",
    );
  });

  it("gives the queue position of a couple", () => {
    expect(addedResult({ guests: couple, placement: "QUEUE", position: 1 })).toBe(
      "No había lugar: Ana López y Luis Pérez quedaron en la cola en la posición 1.",
    );
  });

  it("refuses to describe a queue placement without its position", () => {
    expect(() => addedResult({ guests: solo, placement: "QUEUE", position: null })).toThrow(
      "queue position",
    );
    expect(() => addedResult({ guests: solo, placement: "QUEUE" })).toThrow("queue position");
  });
});
