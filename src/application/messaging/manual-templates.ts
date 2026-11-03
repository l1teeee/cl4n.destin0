import { renderMessageTemplate } from "@/domain/messaging/message-template";
import type { TemplateKey } from "@/domain/messaging/message-types";

import type { LinkedRequestSummary, RequestMessageSubject } from "./conversation-queries";
import type { MessageTemplate } from "./message-templates";

export interface ManualTemplateRepository {
  listTemplates(): Promise<MessageTemplate[]>;
  loadRequestMessageValues(subject: RequestMessageSubject): Promise<Record<string, string>>;
}

export interface RenderedTemplate {
  key: TemplateKey;
  text: string;
}

type RequestReference = Pick<LinkedRequestSummary, "id" | "type">;

// The location has its own send flow (paid guests only, photos, revisions): offering it by hand could leak it.
// The tab needs consumption data that the chat menu cannot render.
function isManualTemplate(template: MessageTemplate): boolean {
  return template.key !== "LOCATION" && template.key !== "TAB";
}

function requestSubject(request: RequestReference): RequestMessageSubject {
  return request.type === "RESERVATION"
    ? { reservationId: request.id }
    : { waitlistEntryId: request.id };
}

// listTemplates already returns the templates in TEMPLATE_KEYS order.
export async function renderTemplatesForRequest(
  repository: ManualTemplateRepository,
  request: RequestReference,
): Promise<RenderedTemplate[]> {
  const [templates, values] = await Promise.all([
    repository.listTemplates(),
    repository.loadRequestMessageValues(requestSubject(request)),
  ]);
  return templates.filter(isManualTemplate).map((template) => ({
    key: template.key,
    text: renderMessageTemplate(template.body, values),
  }));
}
