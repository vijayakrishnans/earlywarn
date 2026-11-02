export function ok<T>(data: T, requestId: string, status = 200): Response {
  return Response.json({ data, meta: { requestId, cursor: null } }, { status });
}

export function fail(
  code: string,
  message: string,
  status: number,
  requestId: string,
  details: Record<string, unknown> = {},
): Response {
  return Response.json({ error: { code, message, details, requestId } }, { status });
}

export const notFound = (requestId: string): Response => fail("not_found", "Not found", 404, requestId);

export const invalid = (requestId: string, fields: Record<string, string[]>): Response =>
  fail("validation_failed", "Validation failed", 422, requestId, { fields });
