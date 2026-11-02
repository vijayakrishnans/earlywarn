// The reporting desk: wire types shared by desk-worker, the SDK and the console.

export const EU_MEMBER_STATES = [
  "AT", "BE", "BG", "HR", "CY", "CZ", "DK", "EE", "FI", "FR", "DE", "GR", "HU", "IE",
  "IT", "LV", "LT", "LU", "MT", "NL", "PL", "PT", "RO", "SK", "SI", "ES", "SE",
] as const;
export type EuMemberState = (typeof EU_MEMBER_STATES)[number];

export const ESCALATION_CHANNELS = ["email", "webhook"] as const;
export type EscalationChannel = (typeof ESCALATION_CHANNELS)[number];

export interface PublicDeskProduct {
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

export interface DeskProductInput {
  name: string;
  productType?: string | null;
  versionsNote?: string | null;
  supportEndsOn?: string | null;
  memberStates: string[];
}

export interface PublicDeskSettings {
  orgId: string;
  publicSlug: string | null;
  policyText: string | null;
  mainEstablishmentState: string | null;
  coordinatingCsirt: string | null;
  triageTargetMinutes: number;
  disclosurePublishedAt: string | null;
  updatedAt: string | null;
}

export interface DeskSettingsInput {
  publicSlug?: string | null;
  policyText?: string | null;
  mainEstablishmentState?: string | null;
  coordinatingCsirt?: string | null;
  triageTargetMinutes?: number;
  /** true publishes the disclosure page, false takes it down, absent leaves it. */
  published?: boolean;
}

export interface PublicEscalationStep {
  id: string;
  position: number;
  name: string;
  email: string;
  afterMinutes: number;
  channels: EscalationChannel[];
}

export interface EscalationStepInput {
  name: string;
  email: string;
  afterMinutes: number;
  channels: EscalationChannel[];
}

export type ReadinessKey = "products" | "markets" | "csirt" | "chain" | "disclosure";

export interface ReadinessItem {
  key: ReadinessKey;
  label: string;
  done: boolean;
  hint: string;
}

export interface DeskReadiness {
  ready: boolean;
  items: ReadinessItem[];
}

export interface ListDeskProductsResponse { products: PublicDeskProduct[] }
export interface DeskProductResponse { product: PublicDeskProduct }
export interface DeskSettingsResponse { settings: PublicDeskSettings }
export interface EscalationChainResponse { steps: PublicEscalationStep[] }
export interface DeskReadinessResponse { readiness: DeskReadiness }

export const DESK_REPORT_STATUSES = ["new", "triaged", "duplicate", "rejected"] as const;
export type DeskReportStatus = (typeof DESK_REPORT_STATUSES)[number];

export interface PublicDeskReport {
  id: string;
  orgId: string;
  title: string;
  details: string;
  product: string | null;
  reporterContact: string | null;
  status: DeskReportStatus;
  receivedAt: string;
  acknowledgedAt: string | null;
}

/** The triage list carries no details; opening one report is what gets audited. */
export type DeskReportSummary = Omit<PublicDeskReport, "details" | "reporterContact">;

export interface ListDeskReportsResponse { reports: DeskReportSummary[]; triageTargetMinutes: number }
export interface DeskReportResponse { report: PublicDeskReport }
export interface DeskReportReceipt { status: "received" | "acknowledged"; receivedAt: string; acknowledgedAt: string | null }
