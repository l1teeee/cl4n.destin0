import { describe, expect, it } from "vitest";

import {
  acceptedResult,
  addedResult,
  cancelPaidConfirmation,
  cancelUnpaidConfirmation,
  cancelledResult,
  chooseReplacementDescription,
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
  type MessageOutcome,
} from "@/ui/admin/guests/guest-copy";

const solo = ["Ana López"];
const couple = ["Ana López", "Luis Pérez"];
const groupOfFour = ["Ana", "Luis", "Marta", "Pedro"];

describe("guestsLabel", () => {
  it("returns the single name", () => {
    expect(guestsLabel(solo)).toBe("Ana López");
  });

  it("joins a couple with y", () => {
    expect(guestsLabel(couple)).toBe("Ana López y Luis Pérez");
  });

  it("joins larger groups with commas and y before the last name", () => {
    expect(guestsLabel(["Ana", "Luis", "Marta"])).toBe("Ana, Luis y Marta");
    expect(guestsLabel(groupOfFour)).toBe("Ana, Luis, Marta y Pedro");
  });
});

describe("partySizeLabel", () => {
  it("uses Individual for one person", () => {
    expect(partySizeLabel(1)).toBe("Individual");
  });

  it("uses Pareja for two people", () => {
    expect(partySizeLabel(2)).toBe("Pareja");
  });

  it("uses Grupo de N for three or more people", () => {
    expect(partySizeLabel(3)).toBe("Grupo de 3");
    expect(partySizeLabel(4)).toBe("Grupo de 4");
  });
});

const carla = ["Carla"];
const pedro = ["Pedro"];
const pareja = ["Carla", "Mario"];

const oneSeat = "Va a dejar un cupo abierto.";
const twoSeats = "Va a dejar 2 cupos abiertos.";
const emptyQueue = "No hay nadie en la cola.";
const newcomerNote = "Quien entre pasa por revisión, lista y pago.";

describe("rejectConfirmation", () => {
  it.each([
    {
      case: "one seat and an empty cola",
      guests: solo,
      replacements: [],
      waitingCount: 0,
      expected: `Se rechaza la solicitud de Ana López. ${oneSeat} ${emptyQueue}`,
    },
    {
      case: "two seats and one solo entry next",
      guests: couple,
      replacements: [carla],
      waitingCount: 1,
      expected: `Se rechaza la solicitud de Ana López y Luis Pérez. ${twoSeats} La siguiente persona en la cola es Carla.`,
    },
    {
      case: "two seats and one couple entry next",
      guests: couple,
      replacements: [pareja],
      waitingCount: 1,
      expected: `Se rechaza la solicitud de Ana López y Luis Pérez. ${twoSeats} La siguiente en la cola es la pareja Carla y Mario.`,
    },
    {
      case: "four seats and one group entry next",
      guests: groupOfFour,
      replacements: [["Carla", "Mario", "Sofía"]],
      waitingCount: 1,
      expected:
        "Se rechaza la solicitud de Ana, Luis, Marta y Pedro. Va a dejar 4 cupos abiertos. El siguiente en la cola es el grupo de Carla, Mario y Sofía.",
    },
    {
      case: "two seats and two entries next",
      guests: couple,
      replacements: [carla, pedro],
      waitingCount: 2,
      expected: `Se rechaza la solicitud de Ana López y Luis Pérez. ${twoSeats} Las siguientes en la cola son Carla y Pedro.`,
    },
    {
      case: "one seat and a head that does not fit",
      guests: solo,
      replacements: [],
      waitingCount: 1,
      expected: `Se rechaza la solicitud de Ana López. ${oneSeat} Nadie de la cola cabe automáticamente; el cupo quedará libre.`,
    },
    {
      case: "two seats and a head that does not fit",
      guests: couple,
      replacements: [],
      waitingCount: 1,
      expected: `Se rechaza la solicitud de Ana López y Luis Pérez. ${twoSeats} Nadie de la cola cabe automáticamente; los cupos quedarán libres.`,
    },
  ])("words $case", ({ guests, replacements, waitingCount, expected }) => {
    expect(rejectConfirmation({ guests, replacements, waitingCount })).toBe(expected);
  });
});

describe("cancelUnpaidConfirmation", () => {
  it.each([
    {
      case: "one guest and an empty cola",
      guests: solo,
      replacements: [],
      waitingCount: 0,
      expected: `Ana López sale de la lista. ${oneSeat} ${emptyQueue}`,
    },
    {
      case: "a couple and one solo entry next",
      guests: couple,
      replacements: [carla],
      waitingCount: 1,
      expected: `Ana López y Luis Pérez salen de la lista. ${twoSeats} La siguiente persona en la cola es Carla.`,
    },
    {
      case: "one guest and two entries next",
      guests: solo,
      replacements: [carla, pedro],
      waitingCount: 2,
      expected: `Ana López sale de la lista. ${oneSeat} Las siguientes en la cola son Carla y Pedro.`,
    },
  ])("words $case", ({ guests, replacements, waitingCount, expected }) => {
    expect(cancelUnpaidConfirmation({ guests, replacements, waitingCount })).toBe(expected);
  });
});

describe("cancelPaidConfirmation", () => {
  it.each([
    {
      case: "one guest with one entry next",
      guests: solo,
      replacements: [carla],
      expected: `Ana López sale de la lista. Ya pagó: quedará pendiente el reembolso. ${oneSeat} La siguiente persona en la cola es Carla. ${newcomerNote}`,
    },
    {
      case: "a couple with two entries next",
      guests: couple,
      replacements: [carla, pedro],
      expected: `Ana López y Luis Pérez salen de la lista. Ya pagaron: quedará pendiente el reembolso. ${twoSeats} Las siguientes en la cola son Carla y Pedro. ${newcomerNote}`,
    },
  ])("adds the refund and process notes for $case", ({ guests, replacements, expected }) => {
    expect(
      cancelPaidConfirmation({ guests, replacements, waitingCount: replacements.length }),
    ).toBe(expected);
  });

  it.each([
    {
      case: "one guest",
      guests: solo,
      expected: `Ana López sale de la lista. Ya pagó: quedará pendiente el reembolso. ${oneSeat} ${emptyQueue}`,
    },
    {
      case: "a couple",
      guests: couple,
      expected: `Ana López y Luis Pérez salen de la lista. Ya pagaron: quedará pendiente el reembolso. ${twoSeats} ${emptyQueue}`,
    },
  ])("omits the process note when nobody enters for $case", ({ guests, expected }) => {
    const text = cancelPaidConfirmation({ guests, replacements: [], waitingCount: 0 });

    expect(text).toBe(expected);
    expect(text).not.toContain("Quien entre");
  });
});

describe("chooseReplacementDescription", () => {
  it("asks who to add and states the open seats", () => {
    expect(chooseReplacementDescription(1)).toBe(
      `Elige a quién agregar a la lista en su lugar. ${oneSeat}`,
    );
    expect(chooseReplacementDescription(2)).toBe(
      `Elige a quién agregar a la lista en su lugar. ${twoSeats}`,
    );
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
    expect(acceptedResult({ guests: solo, outcome: "NOT_SENT", paymentMissing: false })).toBe(
      "Aceptaste a Ana López. Ya está en la lista.",
    );
  });

  it("uses the plural and appends the outcome after a space", () => {
    expect(acceptedResult({ guests: couple, outcome: "SENT", paymentMissing: false })).toBe(
      "Aceptaste a Ana López y Luis Pérez. Ya están en la lista. Mensaje enviado por Instagram.",
    );
  });

  it("warns at the end that the message went out without the payment data", () => {
    expect(acceptedResult({ guests: solo, outcome: "SENT", paymentMissing: true })).toBe(
      "Aceptaste a Ana López. Ya está en la lista. Mensaje enviado por Instagram. Faltan datos de pago: el mensaje salió sin ellos.",
    );
    expect(acceptedResult({ guests: solo, outcome: "NOT_SENT", paymentMissing: true })).toBe(
      "Aceptaste a Ana López. Ya está en la lista. Faltan datos de pago: el mensaje salió sin ellos.",
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
