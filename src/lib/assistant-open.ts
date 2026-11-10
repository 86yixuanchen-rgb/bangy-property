import type { AssistantContext } from "./assistant-property";
export type AssistantOpenDetail = {
  sessionId?: string | undefined;
  stepId?: string | undefined;
  context?: AssistantContext;
  label?: string;
};
export function openAssistant(detail: AssistantOpenDetail) {
  window.dispatchEvent(new CustomEvent("assistant-open", { detail }));
}
