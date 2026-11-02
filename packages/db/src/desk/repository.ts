import type { SqlExecutor } from "../d1/executor.js";
import { executeBatch } from "../d1/executor.js";
import { isUniqueViolation } from "../d1/errors.js";

export interface DeskProduct {
  id: string;
  orgId: string;
  name: string;
  productType: string | null;
  versionsNote: string | null;
  supportEndsOn: string | null;
  memberStates: string[];
  createdAt: string;
  updatedAt: string;
}

export interface DeskProductWrite {
  name: string;
  productType: string | null;
  versionsNote: string | null;
  supportEndsOn: string | null;
  memberStates: string[];
}

export interface DeskSettings {
  orgId: string;
  publicSlug: string | null;
  policyText: string | null;
  mainEstablishmentState: string | null;
  coordinatingCsirt: string | null;
  triageTargetMinutes: number;
  disclosurePublishedAt: string | null;
  updatedAt: string | null;
}

export interface EscalationStep {
  id: string;
  position: number;
  name: string;
  email: string;
  afterMinutes: number;
  channels: string[];
}

type Row = Record<string, unknown>;

function parseList(value: unknown): string[] {
  try {
    const parsed: unknown = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function nullable(value: unknown): string | null {
  return value === null || value === undefined ? null : String(value);
}

function mapProduct(row: Row): DeskProduct {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    name: String(row.name),
    productType: nullable(row.product_type),
    versionsNote: nullable(row.versions_note),
    supportEndsOn: nullable(row.support_ends_on),
    memberStates: parseList(row.member_states),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export function emptyDeskSettings(orgId: string): DeskSettings {
  return {
    orgId,
    publicSlug: null,
    policyText: null,
    mainEstablishmentState: null,
    coordinatingCsirt: null,
    triageTargetMinutes: 240,
    disclosurePublishedAt: null,
    updatedAt: null,
  };
}

function mapSettings(row: Row): DeskSettings {
  return {
    orgId: String(row.org_id),
    publicSlug: nullable(row.public_slug),
    policyText: nullable(row.policy_text),
    mainEstablishmentState: nullable(row.main_establishment_state),
    coordinatingCsirt: nullable(row.coordinating_csirt),
    triageTargetMinutes: Number(row.triage_target_minutes),
    disclosurePublishedAt: nullable(row.disclosure_published_at),
    updatedAt: nullable(row.updated_at),
  };
}

function mapStep(row: Row): EscalationStep {
  return {
    id: String(row.id),
    position: Number(row.position),
    name: String(row.name),
    email: String(row.email),
    afterMinutes: Number(row.after_minutes),
    channels: parseList(row.channels),
  };
}

export type SlugWrite = { ok: true; settings: DeskSettings } | { ok: false; reason: "slug_taken" };

/** Every statement scopes by org_id; nothing here reads across tenants. */
export function createDeskRepository(executor: SqlExecutor) {
  return {
    async listProducts(orgId: string): Promise<DeskProduct[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_products WHERE org_id = $1 AND deleted_at IS NULL ORDER BY created_at, id`,
        [orgId],
      );
      return rows.map(mapProduct);
    },

    async getProduct(orgId: string, id: string): Promise<DeskProduct | null> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_products WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL`,
        [orgId, id],
      );
      return rows[0] ? mapProduct(rows[0]) : null;
    },

    async createProduct(orgId: string, id: string, input: DeskProductWrite, now: string): Promise<DeskProduct> {
      const { rows } = await executor.execute<Row>(
        `INSERT INTO desk_products
           (id, org_id, name, product_type, versions_note, support_ends_on, member_states, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING *`,
        [id, orgId, input.name, input.productType, input.versionsNote, input.supportEndsOn, JSON.stringify(input.memberStates), now],
      );
      return mapProduct(rows[0]!);
    },

    async updateProduct(orgId: string, id: string, input: DeskProductWrite, now: string): Promise<DeskProduct | null> {
      const { rows } = await executor.execute<Row>(
        `UPDATE desk_products
            SET name = $3, product_type = $4, versions_note = $5, support_ends_on = $6, member_states = $7, updated_at = $8
          WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING *`,
        [orgId, id, input.name, input.productType, input.versionsNote, input.supportEndsOn, JSON.stringify(input.memberStates), now],
      );
      return rows[0] ? mapProduct(rows[0]) : null;
    },

    async deleteProduct(orgId: string, id: string, now: string): Promise<boolean> {
      const { rowCount } = await executor.execute(
        `UPDATE desk_products SET deleted_at = $3, updated_at = $3
          WHERE org_id = $1 AND id = $2 AND deleted_at IS NULL RETURNING id`,
        [orgId, id, now],
      );
      return rowCount > 0;
    },

    async getSettings(orgId: string): Promise<DeskSettings> {
      const { rows } = await executor.execute<Row>(`SELECT * FROM desk_settings WHERE org_id = $1`, [orgId]);
      return rows[0] ? mapSettings(rows[0]) : emptyDeskSettings(orgId);
    },

    async saveSettings(settings: DeskSettings, now: string): Promise<SlugWrite> {
      try {
        const { rows } = await executor.execute<Row>(
          `INSERT INTO desk_settings
             (org_id, public_slug, policy_text, main_establishment_state, coordinating_csirt,
              triage_target_minutes, disclosure_published_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
           ON CONFLICT (org_id) DO UPDATE SET
             public_slug = excluded.public_slug,
             policy_text = excluded.policy_text,
             main_establishment_state = excluded.main_establishment_state,
             coordinating_csirt = excluded.coordinating_csirt,
             triage_target_minutes = excluded.triage_target_minutes,
             disclosure_published_at = excluded.disclosure_published_at,
             updated_at = excluded.updated_at
           RETURNING *`,
          [
            settings.orgId,
            settings.publicSlug,
            settings.policyText,
            settings.mainEstablishmentState,
            settings.coordinatingCsirt,
            settings.triageTargetMinutes,
            settings.disclosurePublishedAt,
            now,
          ],
        );
        return { ok: true, settings: mapSettings(rows[0]!) };
      } catch (err) {
        if (isUniqueViolation(err)) return { ok: false, reason: "slug_taken" };
        throw err;
      }
    },

    async listEscalation(orgId: string): Promise<EscalationStep[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_escalation_steps WHERE org_id = $1 ORDER BY position`,
        [orgId],
      );
      return rows.map(mapStep);
    },

    /** Replaces the whole chain atomically: a half-written chain could page nobody. */
    async replaceEscalation(
      orgId: string,
      steps: Array<Omit<EscalationStep, "position">>,
      now: string,
    ): Promise<EscalationStep[]> {
      await executeBatch(executor, [
        { text: `DELETE FROM desk_escalation_steps WHERE org_id = $1`, params: [orgId] },
        ...steps.map((step, index) => ({
          text: `INSERT INTO desk_escalation_steps
                   (id, org_id, position, name, email, after_minutes, channels, created_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          params: [step.id, orgId, index + 1, step.name, step.email, step.afterMinutes, JSON.stringify(step.channels), now],
        })),
      ]);
      return this.listEscalation(orgId);
    },
  };
}

export type DeskRepository = ReturnType<typeof createDeskRepository>;
