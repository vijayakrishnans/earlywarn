import { renderEmailTemplate } from "@notifications-worker/templates/index";

describe("the desk alert email", () => {
  const data = {
    headline: "Unacknowledged case escalated to you",
    title: '<img src=x onerror="alert(1)">',
    detail: "Early warning due soon.",
    url: "https://console.example/x?a=1&b=2",
    chainHead: "ab".repeat(32),
  };

  it("renders every field, escaped", () => {
    const email = renderEmailTemplate("desk.alert", data, { brandName: "Earlywarn" })!;
    expect(email.subject).toContain("[Earlywarn] Unacknowledged case escalated to you");
    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img");
    expect(email.html).toContain("a=1&amp;b=2");
    expect(email.text).toContain(`Timeline fingerprint at this alert: ${"ab".repeat(32)}`);
  });

  it("does without a link or fingerprint", () => {
    const email = renderEmailTemplate("desk.alert", { headline: "H", title: "T", detail: "D", url: null, chainHead: null })!;
    expect(email.html).not.toContain("<a ");
    expect(email.text).not.toContain("fingerprint");
  });
});
