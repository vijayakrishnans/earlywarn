// ENISA's Single Reporting Platform fields, transcribed from its SRP Glossary.
//
// Retrieved 2026-11-02 for SRP v1.2.1. ENISA says its documentation is still being
// updated, and this per-stage mapping came from a text extraction of a table, so it
// has not been checked field by field against the portal: see risk EW-G. Earlywarn
// prepares values for a person to enter; the portal's own form is the authority.

export const SRP_CATALOG_VERSION = "1.2.1 (retrieved 2026-11-02)";

export const SRP_STAGES = ["early_warning", "notification", "final"] as const;
export type SrpStage = (typeof SRP_STAGES)[number];
export type SrpCaseKind = "vulnerability" | "incident";
export type SrpRequirement = "required" | "optional";

export interface SrpField {
  id: string;
  label: string;
  /** Absent for a kind means the field does not apply to it. */
  kinds: readonly SrpCaseKind[];
  stages: Partial<Record<SrpStage, SrpRequirement>>;
  note?: string;
}

const BOTH = ["vulnerability", "incident"] as const;
const AEV = ["vulnerability"] as const;
const SI = ["incident"] as const;
const R = "required" as const;
const O = "optional" as const;

export const SRP_FIELDS: readonly SrpField[] = [
  { id: "1", label: "Notification type", kinds: BOTH, stages: { early_warning: R } },
  { id: "2", label: "Title", kinds: BOTH, stages: { early_warning: R } },
  { id: "3", label: "Summary", kinds: BOTH, stages: { early_warning: R } },
  { id: "4", label: "Manufacturer name", kinds: BOTH, stages: { early_warning: R } },
  { id: "5", label: "Member States where product available", kinds: BOTH, stages: { early_warning: R } },
  { id: "6", label: "Product name", kinds: BOTH, stages: { early_warning: R } },
  { id: "7", label: "Product version", kinds: BOTH, stages: { early_warning: R } },
  { id: "7a", label: "Additional information", kinds: BOTH, stages: { early_warning: O } },
  { id: "8", label: "Product type", kinds: BOTH, stages: { early_warning: O } },
  { id: "9", label: "Product class", kinds: BOTH, stages: { early_warning: O } },
  { id: "10", label: "Product category", kinds: BOTH, stages: { early_warning: O } },
  { id: "11", label: "End of the support indicator", kinds: BOTH, stages: { early_warning: O } },
  { id: "12", label: "Component name", kinds: BOTH, stages: { early_warning: O } },
  { id: "13", label: "Mitigating measure expected shortly", kinds: BOTH, stages: { early_warning: O } },
  { id: "14", label: "User action able to reduce impact", kinds: BOTH, stages: { early_warning: O } },
  { id: "15", label: "Considered sensitivity of information", kinds: BOTH, stages: { early_warning: O, notification: O } },
  { id: "16", label: "Corrective or mitigating measures taken", kinds: BOTH, stages: { early_warning: O, notification: O, final: R } },
  { id: "17", label: "Corrective or mitigating measures that users can take", kinds: BOTH, stages: { early_warning: O, notification: O, final: R } },
  { id: "18", label: "Attack vector", kinds: BOTH, stages: { notification: O } },
  { id: "40", label: "AR note", kinds: BOTH, stages: { early_warning: O, notification: O, final: O } },
  { id: "41", label: "CSIRT note", kinds: BOTH, stages: { early_warning: O, notification: O, final: O } },

  { id: "v19", label: "CVE ID", kinds: AEV, stages: { early_warning: O } },
  { id: "v20", label: "EUVD ID", kinds: AEV, stages: { early_warning: O } },
  { id: "v21", label: "General information", kinds: AEV, stages: { early_warning: O, notification: R } },
  { id: "v22", label: "Date when corrective or mitigating measure has been available", kinds: AEV, stages: { early_warning: O, notification: O, final: R } },
  { id: "v23", label: "Details about the security update or corrective measure available", kinds: AEV, stages: { early_warning: O, notification: O, final: R } },
  { id: "v24", label: "Description of the severity of the vulnerability", kinds: AEV, stages: { early_warning: O, notification: O, final: R } },
  { id: "v25", label: "Description of the impact of the vulnerability", kinds: AEV, stages: { early_warning: O, notification: O, final: R } },
  { id: "v26", label: "Date and time when you became aware of the vulnerability", kinds: AEV, stages: { early_warning: R } },
  { id: "v26a", label: "Date and time when the exploitation occurred", kinds: AEV, stages: { early_warning: O, notification: O } },
  { id: "v27", label: "Malicious actor", kinds: AEV, stages: { early_warning: O, notification: O, final: O }, note: "Required in the final report if the information is available." },
  { id: "v28", label: "Particularly Exceptional Circumstances (PEC)", kinds: AEV, stages: { notification: O } },
  { id: "v29", label: "PEC delay reason", kinds: AEV, stages: { notification: O }, note: "Applies when PEC is activated." },
  { id: "v30", label: "Further information", kinds: AEV, stages: { notification: O }, note: "Applies when PEC is activated." },

  { id: "i31", label: "Incident is suspected of unlawful or malicious acts", kinds: SI, stages: { early_warning: R, notification: O } },
  { id: "i32", label: "General information about the nature of the incident", kinds: SI, stages: { early_warning: O, notification: R } },
  { id: "i33", label: "Applied and ongoing mitigation measures", kinds: SI, stages: { early_warning: O, notification: O, final: R } },
  { id: "i34", label: "Detailed description of the severity of the incident", kinds: SI, stages: { early_warning: O, notification: O, final: R } },
  { id: "i35", label: "Detailed description of the impact of the incident", kinds: SI, stages: { early_warning: O, notification: O, final: R } },
  { id: "i36", label: "Type of threat or root cause", kinds: SI, stages: { early_warning: O, notification: O, final: R } },
  { id: "i37", label: "Date and time when you became aware of the incident", kinds: SI, stages: { early_warning: R } },
  { id: "i38", label: "Date and time when the incident occurred", kinds: SI, stages: { early_warning: O, notification: O } },
  { id: "i39", label: "Initial assessment of the incident", kinds: SI, stages: { early_warning: O, notification: R } },
];

export function fieldsForStage(kind: SrpCaseKind, stage: SrpStage): Array<SrpField & { requirement: SrpRequirement }> {
  return SRP_FIELDS.filter((f) => f.kinds.includes(kind) && f.stages[stage]).map((f) => ({
    ...f,
    requirement: f.stages[stage]!,
  }));
}
