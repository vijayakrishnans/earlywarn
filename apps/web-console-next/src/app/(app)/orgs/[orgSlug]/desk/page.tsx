"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, Circle } from "lucide-react";
import { EU_MEMBER_STATES, type DeskSettingsInput, type ReadinessKey } from "@saas/contracts/desk";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

const FIX_PATHS: Partial<Record<ReadinessKey, string>> = {
  products: "desk/products",
  markets: "desk/products",
  chain: "desk/escalation",
};

export default function DeskPage() {
  const params = useParams<{ orgSlug: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} orgSlug={org.slug} />}</OrgScope>;
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const qc = useQueryClient();
  const readiness = useApiQuery(qk.deskReadiness(orgId), () =>
    wrap(async () => (await client.desk.readiness(orgId)).readiness),
  );
  const settings = useApiQuery(qk.deskSettings(orgId), () =>
    wrap(async () => (await client.desk.getSettings(orgId)).settings),
  );

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.deskReadiness(orgId) });
    void qc.invalidateQueries({ queryKey: qk.deskSettings(orgId) });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Readiness</h1>
        <p className="text-sm text-muted-foreground">
          What your team needs in place before a report arrives at 3am. Earlywarn records your decisions and keeps the
          deadlines; it is not legal advice and does not file on your behalf.
        </p>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle>Checklist</CardTitle>
          {readiness.data ? (
            <Badge variant={readiness.data.ready ? "default" : "secondary"}>
              {readiness.data.ready ? "Ready" : "Not ready yet"}
            </Badge>
          ) : null}
        </CardHeader>
        <CardContent>
          {readiness.loading && !readiness.data ? <Skeleton className="h-32 w-full" /> : null}
          {readiness.error ? <p className="text-sm text-destructive">{readiness.error.message}</p> : null}
          <ul className="space-y-3">
            {(readiness.data?.items ?? []).map((item) => {
              const fix = FIX_PATHS[item.key];
              return (
                <li key={item.key} className="flex items-start gap-3">
                  {item.done ? (
                    <CheckCircle2 className="mt-0.5 h-4 w-4 text-primary" aria-label="Done" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 text-muted-foreground" aria-label="To do" />
                  )}
                  <div>
                    <p className="text-sm font-medium">
                      {fix && !item.done ? (
                        <Link className="underline" href={`/orgs/${orgSlug}/${fix}`}>
                          {item.label}
                        </Link>
                      ) : (
                        item.label
                      )}
                    </p>
                    <p className="text-sm text-muted-foreground">{item.hint}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        </CardContent>
      </Card>

      {settings.data ? <SettingsForm orgId={orgId} initial={settings.data} onSaved={refresh} /> : null}
    </div>
  );
}

function SettingsForm({
  orgId,
  initial,
  onSaved,
}: {
  orgId: string;
  initial: {
    publicSlug: string | null;
    policyText: string | null;
    mainEstablishmentState: string | null;
    coordinatingCsirt: string | null;
    disclosurePublishedAt: string | null;
  };
  onSaved: () => void;
}) {
  const { client } = useSession();
  const { toast } = useToast();
  const [state, setState] = React.useState(initial.mainEstablishmentState ?? "");
  const [csirt, setCsirt] = React.useState(initial.coordinatingCsirt ?? "");
  const [slug, setSlug] = React.useState(initial.publicSlug ?? "");
  const [policy, setPolicy] = React.useState(initial.policyText ?? "");
  const [busy, setBusy] = React.useState(false);
  const published = !!initial.disclosurePublishedAt;

  const save = async (extra: Pick<DeskSettingsInput, "published">) => {
    setBusy(true);
    const result = await wrap(() =>
      client.desk.saveSettings(orgId, {
        mainEstablishmentState: state || null,
        coordinatingCsirt: csirt,
        publicSlug: slug || null,
        policyText: policy,
        ...extra,
      }),
    );
    setBusy(false);
    if (result.ok) {
      toast({ kind: "success", title: "Saved" });
      onSaved();
    } else {
      toast({ kind: "error", title: "Could not save", description: result.error.message });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Reporting details</CardTitle>
        <CardDescription>Your coordinating CSIRT and your public disclosure page.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="desk-state">Main EU establishment</Label>
            <select
              id="desk-state"
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
              value={state}
              onChange={(e) => setState(e.target.value)}
            >
              <option value="">Choose a Member State</option>
              {EU_MEMBER_STATES.map((code) => (
                <option key={code} value={code}>
                  {code}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="desk-csirt">Coordinating CSIRT</Label>
            <Input id="desk-csirt" value={csirt} maxLength={200} onChange={(e) => setCsirt(e.target.value)} />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desk-slug">Public address</Label>
          <Input
            id="desk-slug"
            value={slug}
            maxLength={63}
            placeholder="your-company"
            onChange={(e) => setSlug(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="desk-policy">Disclosure policy</Label>
          <Textarea id="desk-policy" rows={6} value={policy} onChange={(e) => setPolicy(e.target.value)} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button disabled={busy} onClick={() => void save({})}>
            Save
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void save({ published: !published })}>
            {published ? "Take page down" : "Save and publish"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
