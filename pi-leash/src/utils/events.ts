import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export const LEASH_BLOCKED_EVENT = "leash:blocked";
export const LEASH_DANGEROUS_EVENT = "leash:dangerous";

export interface LeashBlockedEvent {
  feature: "policies" | "permissionGate";
  toolName: string;
  input: Record<string, unknown>;
  reason: string;
  userDenied?: boolean;
}

export interface LeashDangerousEvent {
  command: string;
  description: string;
  pattern: string;
}

export function emitBlocked(
  pi: ExtensionAPI,
  event: LeashBlockedEvent,
): void {
  pi.events.emit(LEASH_BLOCKED_EVENT, event);
}

export function emitDangerous(
  pi: ExtensionAPI,
  event: LeashDangerousEvent,
): void {
  pi.events.emit(LEASH_DANGEROUS_EVENT, event);
}
