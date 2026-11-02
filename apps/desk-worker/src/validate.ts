import {
  ESCALATION_CHANNELS,
  EU_MEMBER_STATES,
  type DeskSettingsInput,
  type EscalationStepInput,
} from "@saas/contracts/desk";
import type { DeskProductWrite } from "@saas/db/desk";

export type Fields = Record<string, string[]>;
export type Valid<T> = { ok: true; value: T } | { ok: false; fields: Fields };

const STATES: ReadonlySet<string> = new Set(EU_MEMBER_STATES);
const CHANNELS: ReadonlySet<string> = new Set(ESCALATION_CHANNELS);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const SLUG_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export const MAX_ESCALATION_STEPS = 8;

function text(value: unknown, max: number): string | null | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value !== "string" || value.length > max) return undefined;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function object(body: unknown): Record<string, unknown> | null {
  return body && typeof body === "object" && !Array.isArray(body) ? (body as Record<string, unknown>) : null;
}

export function parseProduct(body: unknown): Valid<DeskProductWrite> {
  const input = object(body);
  if (!input) return { ok: false, fields: { body: ["Must be an object"] } };
  const fields: Fields = {};
  const name = text(input.name, 120);
  if (!name) fields.name = ["Required, at most 120 characters"];
  const supportEndsOn = text(input.supportEndsOn, 10) ?? null;
  if (supportEndsOn !== null && !DATE_RE.test(supportEndsOn)) fields.supportEndsOn = ["Must be YYYY-MM-DD"];
  const states = input.memberStates;
  if (!Array.isArray(states) || states.some((s) => typeof s !== "string" || !STATES.has(s))) {
    fields.memberStates = ["Must be a list of EU Member State codes"];
  }
  if (Object.keys(fields).length > 0) return { ok: false, fields };
  return {
    ok: true,
    value: {
      name: name!,
      productType: text(input.productType, 120) ?? null,
      versionsNote: text(input.versionsNote, 500) ?? null,
      supportEndsOn,
      memberStates: [...new Set(states as string[])].sort(),
    },
  };
}

export function parseSettings(body: unknown): Valid<DeskSettingsInput> {
  const input = object(body);
  if (!input) return { ok: false, fields: { body: ["Must be an object"] } };
  const fields: Fields = {};
  const value: DeskSettingsInput = {};

  if (input.publicSlug !== undefined) {
    const slug = input.publicSlug;
    if (slug !== null && (typeof slug !== "string" || !SLUG_RE.test(slug))) {
      fields.publicSlug = ["Lowercase letters, numbers and hyphens, at most 63 characters"];
    } else value.publicSlug = slug as string | null;
  }
  if (input.policyText !== undefined) {
    const policy = text(input.policyText, 20000);
    if (policy === undefined) fields.policyText = ["Must be text, at most 20000 characters"];
    else value.policyText = policy;
  }
  if (input.mainEstablishmentState !== undefined) {
    const state = input.mainEstablishmentState;
    if (state !== null && (typeof state !== "string" || !STATES.has(state))) {
      fields.mainEstablishmentState = ["Must be an EU Member State code"];
    } else value.mainEstablishmentState = state as string | null;
  }
  if (input.coordinatingCsirt !== undefined) {
    const csirt = text(input.coordinatingCsirt, 200);
    if (csirt === undefined) fields.coordinatingCsirt = ["Must be text, at most 200 characters"];
    else value.coordinatingCsirt = csirt;
  }
  if (input.triageTargetMinutes !== undefined) {
    const minutes = input.triageTargetMinutes;
    if (!Number.isInteger(minutes) || (minutes as number) < 5 || (minutes as number) > 1440) {
      fields.triageTargetMinutes = ["Must be a whole number of minutes from 5 to 1440"];
    } else value.triageTargetMinutes = minutes as number;
  }
  if (input.published !== undefined) {
    if (typeof input.published !== "boolean") fields.published = ["Must be true or false"];
    else value.published = input.published;
  }
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}

export function parseEscalation(body: unknown): Valid<EscalationStepInput[]> {
  const steps = object(body)?.steps;
  if (!Array.isArray(steps)) return { ok: false, fields: { steps: ["Must be a list"] } };
  if (steps.length > MAX_ESCALATION_STEPS) {
    return { ok: false, fields: { steps: [`At most ${MAX_ESCALATION_STEPS} steps`] } };
  }
  const fields: Fields = {};
  const value: EscalationStepInput[] = [];
  steps.forEach((raw, index) => {
    const step = object(raw);
    const name = step ? text(step.name, 120) : null;
    const email = step ? text(step.email, 254) : null;
    const after = step?.afterMinutes;
    const channels = step?.channels;
    const errors: string[] = [];
    if (!name) errors.push("name is required");
    if (!email || !EMAIL_RE.test(email)) errors.push("email must be valid");
    if (!Number.isInteger(after) || (after as number) < 0 || (after as number) > 1440) {
      errors.push("afterMinutes must be from 0 to 1440");
    }
    if (
      !Array.isArray(channels) ||
      channels.length === 0 ||
      channels.some((c) => typeof c !== "string" || !CHANNELS.has(c))
    ) {
      errors.push("channels must name email or webhook");
    }
    if (errors.length > 0) {
      fields[`steps.${index}`] = errors;
      return;
    }
    value.push({
      name: name!,
      email: email!,
      // The first step is alerted at once, whatever was entered.
      afterMinutes: index === 0 ? 0 : (after as number),
      channels: [...new Set(channels as EscalationStepInput["channels"])],
    });
  });
  return Object.keys(fields).length > 0 ? { ok: false, fields } : { ok: true, value };
}
