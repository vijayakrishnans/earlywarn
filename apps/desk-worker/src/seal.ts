// AES-GCM for report contents. The additional data binds a ciphertext to its
// organization and report, so a row copied elsewhere will not open.

export interface ReportContents {
  title: string;
  details: string;
  product: string | null;
  reporterContact: string | null;
}

const encoder = new TextEncoder();

function fromBase64(value: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

async function importKey(base64Key: string): Promise<CryptoKey> {
  const raw = fromBase64(base64Key);
  if (raw.length !== 32) throw new Error("desk: encryption key must be 32 bytes");
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}

const additionalData = (orgId: string, reportId: string): Uint8Array<ArrayBuffer> =>
  new Uint8Array(encoder.encode(`${orgId}:${reportId}`));

export async function sealReport(
  contents: ReportContents,
  base64Key: string,
  orgId: string,
  reportId: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: additionalData(orgId, reportId) },
    await importKey(base64Key),
    encoder.encode(JSON.stringify(contents)),
  );
  return `v1.${toBase64(iv)}.${toBase64(new Uint8Array(ciphertext))}`;
}

export async function openReport(
  sealed: string,
  base64Key: string,
  orgId: string,
  reportId: string,
): Promise<ReportContents> {
  const [version, iv, ciphertext] = sealed.split(".");
  if (version !== "v1" || !iv || !ciphertext) throw new Error("desk: unknown sealed format");
  const plain = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: fromBase64(iv), additionalData: additionalData(orgId, reportId) },
    await importKey(base64Key),
    fromBase64(ciphertext),
  );
  return JSON.parse(new TextDecoder().decode(plain)) as ReportContents;
}

export function newReceiptToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function hashReceiptToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", encoder.encode(token));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
