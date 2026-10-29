import { z } from "zod";

import { MAX_EVENT_CLUE_LENGTH } from "@/domain/event/event-clues";

export const eventClueSchema = z
  .object({
    body: z
      .string()
      .trim()
      .min(1, "Escribe la pista.")
      .max(MAX_EVENT_CLUE_LENGTH, "La pista no puede superar 500 caracteres."),
  })
  .strict();
