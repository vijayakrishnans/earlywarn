// The tamper-evident timeline: hash = sha256(prevHash + "\n" + canonical(event)).
// Changing, removing or reordering any stored event breaks every hash after it.
// The evidence export's offline verifier repeats exactly this calculation.

export const GENESIS_HASH = "0".repeat(64);

export interface ChainEvent {
  caseId: string;
  seq: number;
  type: string;
  actor: string;
  payload: string;
  occurredAt: string;
}

export interface ChainedEvent extends ChainEvent {
  prevHash: string;
  hash: string;
}

export function canonicalEvent(event: ChainEvent): string {
  return JSON.stringify({
    actor: event.actor,
    caseId: event.caseId,
    occurredAt: event.occurredAt,
    payload: event.payload,
    seq: event.seq,
    type: event.type,
  });
}

export async function hashEvent(prevHash: string, event: ChainEvent): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(`${prevHash}\n${canonicalEvent(event)}`),
  );
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function verifyChain(events: readonly ChainedEvent[]): Promise<boolean> {
  let prev = GENESIS_HASH;
  for (const [index, event] of events.entries()) {
    if (event.seq !== index + 1 || event.prevHash !== prev) return false;
    if ((await hashEvent(prev, event)) !== event.hash) return false;
    prev = event.hash;
  }
  return true;
}
