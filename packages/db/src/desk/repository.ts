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

export type DeskReportStatus = "new" | "triaged" | "duplicate" | "rejected";

export interface DeskReportRow {
  id: string;
  orgId: string;
  sealed: string;
  status: DeskReportStatus;
  receivedAt: string;
  acknowledgedAt: string | null;
}

export interface DeskDisclosure {
  orgId: string;
  publicSlug: string;
  policyText: string;
  publishedAt: string;
}

function mapReport(row: Row): DeskReportRow {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    sealed: String(row.sealed),
    status: String(row.status) as DeskReportStatus,
    receivedAt: String(row.received_at),
    acknowledgedAt: nullable(row.acknowledged_at),
  };
}

export type DeskCaseKind = "vulnerability" | "incident";

export interface DeskCase {
  id: string;
  orgId: string;
  reportId: string | null;
  productId: string;
  kind: DeskCaseKind;
  title: string;
  status: "open" | "closed";
  awareAt: string;
  awareRecordedBy: string;
  correctiveAvailableAt: string | null;
  notificationSubmittedAt: string | null;
  earlyWarningDueAt: string;
  notificationDueAt: string;
  finalDueAt: string | null;
  acknowledgedAt: string | null;
  acknowledgedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DeskCaseEvent {
  id: string;
  caseId: string;
  orgId: string;
  seq: number;
  type: string;
  actor: string;
  payload: string;
  occurredAt: string;
  prevHash: string;
  hash: string;
}

function mapCase(row: Row): DeskCase {
  return {
    id: String(row.id),
    orgId: String(row.org_id),
    reportId: nullable(row.report_id),
    productId: String(row.product_id),
    kind: String(row.kind) as DeskCaseKind,
    title: String(row.title),
    status: String(row.status) as DeskCase["status"],
    awareAt: String(row.aware_at),
    awareRecordedBy: String(row.aware_recorded_by),
    correctiveAvailableAt: nullable(row.corrective_available_at),
    notificationSubmittedAt: nullable(row.notification_submitted_at),
    earlyWarningDueAt: String(row.early_warning_due_at),
    notificationDueAt: String(row.notification_due_at),
    finalDueAt: nullable(row.final_due_at),
    acknowledgedAt: nullable(row.acknowledged_at),
    acknowledgedBy: nullable(row.acknowledged_by),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function mapEvent(row: Row): DeskCaseEvent {
  return {
    id: String(row.id),
    caseId: String(row.case_id),
    orgId: String(row.org_id),
    seq: Number(row.seq),
    type: String(row.type),
    actor: String(row.actor),
    payload: String(row.payload),
    occurredAt: String(row.occurred_at),
    prevHash: String(row.prev_hash),
    hash: String(row.hash),
  };
}

const INSERT_EVENT = `INSERT INTO desk_case_events
  (id, org_id, case_id, seq, type, actor, payload, occurred_at, prev_hash, hash)
  VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`;

function eventParams(e: DeskCaseEvent): unknown[] {
  return [e.id, e.orgId, e.caseId, e.seq, e.type, e.actor, e.payload, e.occurredAt, e.prevHash, e.hash];
}

const UPDATE_CASE = `UPDATE desk_cases SET
  status = $3, aware_at = $4, corrective_available_at = $5, notification_submitted_at = $6,
  early_warning_due_at = $7, notification_due_at = $8, final_due_at = $9,
  acknowledged_at = $10, acknowledged_by = $11, updated_at = $12
  WHERE org_id = $1 AND id = $2`;

function caseParams(c: DeskCase): unknown[] {
  return [
    c.orgId, c.id, c.status, c.awareAt, c.correctiveAvailableAt, c.notificationSubmittedAt,
    c.earlyWarningDueAt, c.notificationDueAt, c.finalDueAt, c.acknowledgedAt, c.acknowledgedBy, c.updatedAt,
  ];
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

    async listCases(orgId: string, limit = 100): Promise<DeskCase[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_cases WHERE org_id = $1 ORDER BY created_at DESC, id LIMIT $2`,
        [orgId, limit],
      );
      return rows.map(mapCase);
    },

    async getCase(orgId: string, id: string): Promise<DeskCase | null> {
      const { rows } = await executor.execute<Row>(`SELECT * FROM desk_cases WHERE org_id = $1 AND id = $2`, [orgId, id]);
      return rows[0] ? mapCase(rows[0]) : null;
    },

    async listCaseEvents(orgId: string, caseId: string): Promise<DeskCaseEvent[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_case_events WHERE org_id = $1 AND case_id = $2 ORDER BY seq`,
        [orgId, caseId],
      );
      return rows.map(mapEvent);
    },

    /** The case and its first event arrive together or not at all. */
    async insertCase(c: DeskCase, first: DeskCaseEvent): Promise<void> {
      await executeBatch(executor, [
        {
          text: `INSERT INTO desk_cases
            (id, org_id, report_id, product_id, kind, title, status, aware_at, aware_recorded_by,
             corrective_available_at, notification_submitted_at, early_warning_due_at, notification_due_at,
             final_due_at, acknowledged_at, acknowledged_by, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)`,
          params: [
            c.id, c.orgId, c.reportId, c.productId, c.kind, c.title, c.status, c.awareAt, c.awareRecordedBy,
            c.correctiveAvailableAt, c.notificationSubmittedAt, c.earlyWarningDueAt, c.notificationDueAt,
            c.finalDueAt, c.acknowledgedAt, c.acknowledgedBy, c.createdAt, c.updatedAt,
          ],
        },
        { text: INSERT_EVENT, params: eventParams(first) },
      ]);
    },

    /**
     * Appends an event and writes the case state it implies, atomically.
     * False means another writer took this position in the chain: re-read and retry.
     */
    async appendCaseEvent(c: DeskCase, event: DeskCaseEvent): Promise<boolean> {
      try {
        await executeBatch(executor, [
          { text: INSERT_EVENT, params: eventParams(event) },
          { text: UPDATE_CASE, params: caseParams(c) },
        ]);
        return true;
      } catch (err) {
        if (isUniqueViolation(err)) return false;
        throw err;
      }
    },

    /** Scheduler only: every open case on the platform, soonest deadline first. */
    async listOpenCasesForScheduler(limit: number): Promise<DeskCase[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_cases WHERE status = 'open' ORDER BY notification_due_at, id LIMIT $1`,
        [limit],
      );
      return rows.map(mapCase);
    },

    /** Scheduler only: new reports that still owe an alert, with their organization's triage target. */
    async listNewReportsForScheduler(limit: number): Promise<Array<{
      id: string;
      orgId: string;
      receivedAt: string;
      triageTargetMinutes: number;
    }>> {
      const { rows } = await executor.execute<Row>(
        `SELECT r.id, r.org_id, r.received_at, COALESCE(s.triage_target_minutes, 240) AS target
           FROM desk_reports r
           LEFT JOIN desk_settings s ON s.org_id = r.org_id
          WHERE r.status = 'new'
            AND NOT EXISTS (SELECT 1 FROM desk_alerts a WHERE a.subject_id = r.id AND a.alert_key = 'triage-late')
          ORDER BY r.received_at LIMIT $1`,
        [limit],
      );
      return rows.map((row) => ({
        id: String(row.id),
        orgId: String(row.org_id),
        receivedAt: String(row.received_at),
        triageTargetMinutes: Number(row.target),
      }));
    },

    async listSentAlerts(subjectId: string): Promise<string[]> {
      const { rows } = await executor.execute<Row>(`SELECT alert_key FROM desk_alerts WHERE subject_id = $1`, [subjectId]);
      return rows.map((row) => String(row.alert_key));
    },

    /** True when this call recorded it; false when an earlier run already had. */
    async recordAlert(
      orgId: string,
      kind: "case" | "report",
      subjectId: string,
      key: string,
      now: string,
    ): Promise<boolean> {
      const { rowCount } = await executor.execute(
        `INSERT INTO desk_alerts (id, org_id, subject_kind, subject_id, alert_key, sent_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (subject_id, alert_key) DO NOTHING RETURNING id`,
        [crypto.randomUUID(), orgId, kind, subjectId, key, now],
      );
      return rowCount > 0;
    },

    /** The one read of settings by public address; only a published page answers. */
    async getDisclosure(slug: string): Promise<DeskDisclosure | null> {
      const { rows } = await executor.execute<Row>(
        `SELECT org_id, public_slug, policy_text, disclosure_published_at FROM desk_settings
          WHERE public_slug = $1 AND disclosure_published_at IS NOT NULL AND policy_text IS NOT NULL`,
        [slug],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        orgId: String(row.org_id),
        publicSlug: String(row.public_slug),
        policyText: String(row.policy_text),
        publishedAt: String(row.disclosure_published_at),
      };
    },

    async createReport(orgId: string, id: string, sealed: string, receiptHash: string, now: string): Promise<void> {
      await executor.execute(
        `INSERT INTO desk_reports (id, org_id, sealed, receipt_hash, received_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $5)`,
        [id, orgId, sealed, receiptHash, now],
      );
    },

    async getReceipt(receiptHash: string): Promise<Pick<DeskReportRow, "status" | "receivedAt" | "acknowledgedAt"> | null> {
      const { rows } = await executor.execute<Row>(
        `SELECT status, received_at, acknowledged_at FROM desk_reports WHERE receipt_hash = $1`,
        [receiptHash],
      );
      const row = rows[0];
      if (!row) return null;
      return {
        status: String(row.status) as DeskReportStatus,
        receivedAt: String(row.received_at),
        acknowledgedAt: nullable(row.acknowledged_at),
      };
    },

    async listReports(orgId: string, limit = 100): Promise<DeskReportRow[]> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_reports WHERE org_id = $1 ORDER BY received_at DESC, id LIMIT $2`,
        [orgId, limit],
      );
      return rows.map(mapReport);
    },

    async getReport(orgId: string, id: string): Promise<DeskReportRow | null> {
      const { rows } = await executor.execute<Row>(
        `SELECT * FROM desk_reports WHERE org_id = $1 AND id = $2`,
        [orgId, id],
      );
      return rows[0] ? mapReport(rows[0]) : null;
    },

    /** Any status decision also acknowledges receipt to the reporter, once. */
    async setReportStatus(orgId: string, id: string, status: DeskReportStatus, now: string): Promise<DeskReportRow | null> {
      const { rows } = await executor.execute<Row>(
        `UPDATE desk_reports
            SET status = $3, acknowledged_at = COALESCE(acknowledged_at, $4), updated_at = $4
          WHERE org_id = $1 AND id = $2 RETURNING *`,
        [orgId, id, status, now],
      );
      return rows[0] ? mapReport(rows[0]) : null;
    },
  };
}

export type DeskRepository = ReturnType<typeof createDeskRepository>;
