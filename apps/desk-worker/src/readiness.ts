import type { DeskReadiness } from "@saas/contracts/desk";
import type { DeskProduct, DeskSettings, EscalationStep } from "@saas/db/desk";

/** What a team needs in place before a 3am report. Derived, never stored. */
export function computeReadiness(
  products: DeskProduct[],
  settings: DeskSettings,
  chain: EscalationStep[],
): DeskReadiness {
  const items: DeskReadiness["items"] = [
    {
      key: "products",
      label: "Register your products",
      done: products.length > 0,
      hint: "List each product with digital elements you sell in the EU.",
    },
    {
      key: "markets",
      label: "Record where each product is sold",
      done: products.length > 0 && products.every((p) => p.memberStates.length > 0),
      hint: "The SRP asks for the Member States where the product is available.",
    },
    {
      key: "csirt",
      label: "Name your coordinating CSIRT",
      done: !!settings.mainEstablishmentState && !!settings.coordinatingCsirt,
      hint: "It follows your main EU establishment or your authorised representative.",
    },
    {
      key: "chain",
      label: "Set a primary and a backup",
      done: chain.length >= 2,
      hint: "Someone must be next when the first person does not acknowledge.",
    },
    {
      key: "disclosure",
      label: "Publish your disclosure page",
      done: !!settings.disclosurePublishedAt,
      hint: "Gives researchers a place to report and sets your public policy.",
    },
  ];
  return { ready: items.every((item) => item.done), items };
}
