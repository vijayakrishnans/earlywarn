import { isDeskRoute, isPublicDeskRoute } from "../../../apps/api-edge/src/desk-facade";

describe("desk routes at the edge", () => {
  it.each([
    "/disclose/acme",
    "/disclose/acme/security.txt",
    `/receipt/${"a".repeat(64)}`,
    `/v1/public/receipts/${"a".repeat(64)}`,
  ])("treats %s as public", (path) => {
    expect(isPublicDeskRoute(path)).toBe(true);
  });

  it.each(["/disclose/acme/admin", "/disclose/", "/v1/public/anything/else", "/v1/organizations/o/desk/reports"])(
    "does not treat %s as public",
    (path) => {
      expect(isPublicDeskRoute(path)).toBe(false);
    },
  );

  it("keeps organization routes behind the session facade", () => {
    expect(isDeskRoute("/v1/organizations/org_1/desk/reports")).toBe(true);
    expect(isDeskRoute("/disclose/acme")).toBe(false);
  });
});
