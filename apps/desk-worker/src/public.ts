import type { DeskReportReceipt } from "@saas/contracts/desk";
import type { DeskDisclosure, DeskRepository } from "@saas/db/desk";
import type { Env } from "./env.js";
import { fail, notFound, ok } from "./http.js";
import { hashReceiptToken, newReceiptToken, sealReport } from "./seal.js";

const DISCLOSE_RE = /^\/disclose\/([a-z0-9-]{1,63})$/;
const SECURITY_TXT_RE = /^\/disclose\/([a-z0-9-]{1,63})\/security\.txt$/;
const RECEIPT_PAGE_RE = /^\/receipt\/([0-9a-f]{64})$/;
const RECEIPT_API_RE = /^\/v1\/public\/receipts\/([0-9a-f]{64})$/;
const MAX_FORM_BYTES = 64_000;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isPublicPath(pathname: string): boolean {
  return pathname.startsWith("/disclose/") || pathname.startsWith("/receipt/") || pathname.startsWith("/v1/public/");
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const STYLE = `body{font:16px/1.55 system-ui,sans-serif;max-width:42rem;margin:2rem auto;padding:0 1rem;color:#1a1a1a}
h1{font-size:1.5rem}label{display:block;font-weight:600;margin-top:1rem}input,textarea{width:100%;box-sizing:border-box;padding:.5rem;font:inherit;border:1px solid #888;border-radius:4px}
button{margin-top:1rem;padding:.6rem 1rem;font:inherit;background:#1a1a1a;color:#fff;border:0;border-radius:4px;cursor:pointer}
.policy{white-space:pre-wrap;border-left:3px solid #ccc;padding-left:1rem}.hint{color:#555;font-size:.9rem}.trap{position:absolute;left:-10000px}code{word-break:break-all}`;

function page(title: string, body: string, status = 200): Response {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`,
    {
      status,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "content-security-policy":
          "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "referrer-policy": "no-referrer",
        "x-content-type-options": "nosniff",
        "cache-control": "no-store",
      },
    },
  );
}

const missingPage = (): Response =>
  page("Not found", "<h1>There is no disclosure page here</h1><p>Check the address with the company.</p>", 404);

function formPage(disclosure: DeskDisclosure, errors: string[] = [], values: Record<string, string> = {}): Response {
  const value = (name: string): string => escapeHtml(values[name] ?? "");
  const errorList =
    errors.length > 0
      ? `<ul role="alert">${errors.map((e) => `<li>${escapeHtml(e)}</li>`).join("")}</ul>`
      : "";
  return page(
    "Report a security vulnerability",
    `<h1>Report a security vulnerability</h1>
<h2>Our policy</h2><div class="policy">${escapeHtml(disclosure.policyText)}</div>
<h2>Your report</h2>${errorList}
<form method="post">
<label for="title">Summary</label><input id="title" name="title" required maxlength="200" value="${value("title")}">
<label for="product">Affected product and version</label><input id="product" name="product" maxlength="200" value="${value("product")}">
<label for="details">Details and how to reproduce</label><textarea id="details" name="details" required rows="10" maxlength="20000">${value("details")}</textarea>
<label for="contact">Your email (optional)</label><input id="contact" name="contact" type="email" maxlength="254" value="${value("contact")}">
<p class="hint">Only needed if you would like a reply. Reports are encrypted when stored.</p>
<div class="trap" aria-hidden="true"><label for="website">Leave this empty</label><input id="website" name="website" tabindex="-1" autocomplete="off"></div>
<button type="submit">Send report</button>
</form>`,
    errors.length > 0 ? 422 : 200,
  );
}

function receiptPage(origin: string, token: string): Response {
  const link = `${origin}/receipt/${token}`;
  return page(
    "Report received",
    `<h1>Report received</h1><p>Thank you. Keep this link to check whether your report has been acknowledged. It will not be shown again.</p><p><a href="${escapeHtml(link)}"><code>${escapeHtml(link)}</code></a></p>`,
    201,
  );
}

async function submit(
  request: Request,
  env: Env,
  repo: DeskRepository,
  disclosure: DeskDisclosure,
  origin: string,
): Promise<Response> {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.startsWith("application/x-www-form-urlencoded") && !contentType.startsWith("multipart/form-data")) {
    return page("Unsupported", "<h1>Please send the form from the page</h1>", 415);
  }
  if (Number(request.headers.get("content-length") ?? 0) > MAX_FORM_BYTES) {
    return page("Too large", "<h1>That report is too long</h1><p>Shorten it to under 20,000 characters.</p>", 413);
  }
  const form = await request.formData();
  const field = (name: string): string => {
    const value = form.get(name);
    return typeof value === "string" ? value.trim() : "";
  };
  const values = { title: field("title"), details: field("details"), product: field("product"), contact: field("contact") };

  const token = newReceiptToken();
  // A bot that fills the hidden field sees success and stores nothing.
  if (field("website")) return receiptPage(origin, token);

  const errors: string[] = [];
  if (!values.title || values.title.length > 200) errors.push("Add a summary of up to 200 characters.");
  if (!values.details || values.details.length > 20_000) errors.push("Add details of up to 20,000 characters.");
  if (values.product.length > 200) errors.push("Keep the product to 200 characters.");
  if (values.contact && (values.contact.length > 254 || !EMAIL_RE.test(values.contact))) {
    errors.push("Enter a valid email address, or leave it empty.");
  }
  if (errors.length > 0) return formPage(disclosure, errors, values);

  const id = crypto.randomUUID();
  const sealed = await sealReport(
    {
      title: values.title,
      details: values.details,
      product: values.product || null,
      reporterContact: values.contact || null,
    },
    env.DESK_ENCRYPTION_KEY!,
    disclosure.orgId,
    id,
  );
  await repo.createReport(disclosure.orgId, id, sealed, await hashReceiptToken(token), new Date().toISOString());
  return receiptPage(origin, token);
}

function securityTxt(disclosure: DeskDisclosure, origin: string, now: Date): Response {
  const url = `${origin}/disclose/${disclosure.publicSlug}`;
  const expires = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  return new Response(
    `Contact: ${url}\nExpires: ${expires}\nPolicy: ${url}\nCanonical: ${url}/security.txt\nPreferred-Languages: en\n`,
    { headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=3600" } },
  );
}

async function receiptFor(repo: DeskRepository, token: string): Promise<DeskReportReceipt | null> {
  const row = await repo.getReceipt(await hashReceiptToken(token));
  if (!row) return null;
  return {
    status: row.acknowledgedAt ? "acknowledged" : "received",
    receivedAt: row.receivedAt,
    acknowledgedAt: row.acknowledgedAt,
  };
}

export async function handlePublicRoute(
  request: Request,
  env: Env,
  repo: DeskRepository,
  pathname: string,
  requestId: string,
): Promise<Response> {
  const origin = request.headers.get("x-public-origin") ?? new URL(request.url).origin;
  const method = request.method;

  const apiReceipt = pathname.match(RECEIPT_API_RE);
  if (apiReceipt) {
    if (method !== "GET") return fail("unsupported", "Method not allowed", 405, requestId);
    const receipt = await receiptFor(repo, apiReceipt[1]!);
    return receipt ? ok({ receipt }, requestId) : notFound(requestId);
  }

  const receiptMatch = pathname.match(RECEIPT_PAGE_RE);
  if (receiptMatch) {
    if (method !== "GET") return page("Not allowed", "<h1>Not allowed</h1>", 405);
    const receipt = await receiptFor(repo, receiptMatch[1]!);
    if (!receipt) return missingPage();
    return page(
      "Report status",
      `<h1>Report status</h1><p>${
        receipt.status === "acknowledged"
          ? `The company acknowledged your report on ${escapeHtml(receipt.acknowledgedAt!)}.`
          : "Your report has been received and is waiting for the company to acknowledge it."
      }</p><p class="hint">Received ${escapeHtml(receipt.receivedAt)}.</p>`,
    );
  }

  const txt = pathname.match(SECURITY_TXT_RE);
  if (txt) {
    if (method !== "GET") return fail("unsupported", "Method not allowed", 405, requestId);
    const disclosure = await repo.getDisclosure(txt[1]!);
    return disclosure ? securityTxt(disclosure, origin, new Date()) : notFound(requestId);
  }

  const form = pathname.match(DISCLOSE_RE);
  if (!form) return missingPage();
  const disclosure = await repo.getDisclosure(form[1]!);
  if (!disclosure) return missingPage();
  if (method === "GET") return formPage(disclosure);
  if (method === "POST") {
    if (!env.DESK_ENCRYPTION_KEY) {
      return page("Unavailable", "<h1>Reports cannot be accepted right now</h1><p>Please try again later.</p>", 503);
    }
    return submit(request, env, repo, disclosure, origin);
  }
  return page("Not allowed", "<h1>Not allowed</h1>", 405);
}
