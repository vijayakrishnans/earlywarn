"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { readStoredToken } from "@/lib/session";
import { readLastOrgSlug, defaultOrgDestination } from "@/lib/last-org";

const STEPS = [
  {
    title: "Take reports in",
    body: "A hosted disclosure page and security.txt. Reports are encrypted when stored, and reporters get a receipt.",
  },
  {
    title: "Record when you knew",
    body: "A named person records the moment of awareness. The 24-hour, 72-hour and final deadlines follow from it.",
  },
  {
    title: "Reach someone at 3am",
    body: "Alerts move to the next person until someone acknowledges, by email or webhook into the paging tool you use.",
  },
  {
    title: "File, and keep the proof",
    body: "Each stage's fields, ready to enter in ENISA's platform, and a tamper-evident timeline you can verify offline.",
  },
];

/** Signed-in visitors go straight to work; everyone else sees what this is. */
export default function HomePage() {
  const router = useRouter();
  const [showLanding, setShowLanding] = React.useState(false);

  React.useEffect(() => {
    if (readStoredToken()) router.replace(defaultOrgDestination(readLastOrgSlug()));
    else setShowLanding(true);
  }, [router]);

  if (!showLanding) {
    return <div className="grid min-h-screen place-items-center text-sm text-muted-foreground">Loading…</div>;
  }

  return (
    <main className="mx-auto max-w-3xl space-y-10 px-6 py-16">
      <header className="space-y-4">
        <p className="text-sm font-medium text-muted-foreground">Earlywarn</p>
        <h1 className="text-4xl font-semibold tracking-tight">Never miss the 24-hour clock.</h1>
        <p className="text-lg text-muted-foreground">
          Since 11 September 2026, makers of software and connected products sold in the EU must report actively
          exploited vulnerabilities and severe incidents within 24 hours of becoming aware. Earlywarn makes sure the
          right person hears about it in time, for teams with no security staff on call.
        </p>
        <Button asChild size="lg">
          <Link href="/login">Get started</Link>
        </Button>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {STEPS.map((step) => (
          <Card key={step.title}>
            <CardHeader>
              <CardTitle className="text-base">{step.title}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">{step.body}</CardContent>
          </Card>
        ))}
      </section>

      <section className="space-y-2 rounded-md border p-4 text-sm" aria-labelledby="limits">
        <h2 id="limits" className="font-medium">
          What Earlywarn does not do
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
          <li>It does not file on your behalf. You submit in ENISA&apos;s Single Reporting Platform.</li>
          <li>It does not decide whether something is reportable. That judgement is yours.</li>
          <li>It is not legal advice and does not make you compliant with the Cyber Resilience Act by itself.</li>
          <li>It does not generate SBOMs or technical documentation.</li>
        </ul>
      </section>
    </main>
  );
}
