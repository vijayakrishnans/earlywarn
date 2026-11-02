import { hexToUuid, uuidFromPublicId, uuidToHex, type Uuid } from "@saas/db/ids";

export const orgPublicId = (uuid: string): string => `org_${uuidToHex(uuid)}`;
export const parseOrgId = (id: string): Uuid | null => uuidFromPublicId(id, "org");
export const productPublicId = (uuid: string): string => `prd_${uuidToHex(uuid)}`;
export const stepPublicId = (uuid: string): string => `esc_${uuidToHex(uuid)}`;

export function parseProductId(id: string): string | null {
  return id.startsWith("prd_") ? hexToUuid(id.slice(4)) : null;
}
export const reportPublicId = (uuid: string): string => `rpt_${uuidToHex(uuid)}`;

export function parseReportId(id: string): string | null {
  return id.startsWith("rpt_") ? hexToUuid(id.slice(4)) : null;
}
