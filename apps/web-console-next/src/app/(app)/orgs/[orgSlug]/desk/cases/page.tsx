"use client";

import * as React from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import type { DeskCaseKind, PublicDeskCase } from "@saas/contracts/desk";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

export default function DeskCasesPage() {
  const params = useParams<{ orgSlug: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} orgSlug={org.slug} />}</OrgScope>;
}

function remaining(dueAt: string | null, now: number): string {
  if (!dueAt) return "not started";
  const ms = new Date(dueAt).getTime() - now;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const span = hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h ${minutes} min`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}

function localNow(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function Inner({ orgId, orgSlug }: { orgId: string; orgSlug: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const router = useRouter();
  const cases = useApiQuery(qk.deskCases(orgId), () => wrap(async () => (await client.desk.listCases(orgId)).cases));
  const products = useApiQuery(qk.deskProducts(orgId), () =>
    wrap(async () => (await client.desk.listProducts(orgId)).products),
  );
  const [title, setTitle] = React.useState("");
  const [kind, setKind] = React.useState<DeskCaseKind>("vulnerability");
  const [productId, setProductId] = React.useState("");
  const [awareAt, setAwareAt] = React.useState(localNow);
  const [busy, setBusy] = React.useState(false);

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await wrap(() =>
      client.desk.createCase(orgId, { title, kind, productId, awareAt: new Date(awareAt).toISOString() }),
    );
    setBusy(false);
    if (result.ok) router.push(`/orgs/${orgSlug}/desk/cases/${result.data.case.id}`);
    else toast({ kind: "error", title: "Could not open the case", description: result.error.message });
  };

  const now = Date.now();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Cases</h1>
        <p className="text-sm text-muted-foreground">
          Open a case once someone decides a vulnerability is actively exploited or an incident is severe. You record
          when you became aware; the deadlines follow from that. Whether something is reportable is your judgement, so
          take legal advice where unsure.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Open a case</CardTitle>
          <CardDescription>Keep the title free of exploit detail; it appears in alerts.</CardDescription>
        </CardHeader>
        <CardContent>
          <form className="grid gap-4 sm:grid-cols-2" onSubmit={(e) => void create(e)}>
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="case-title">Title</Label>
              <Input id="case-title" required maxLength={200} value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-kind">Type</Label>
              <select
                id="case-kind"
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={kind}
                onChange={(e) => setKind(e.target.value as DeskCaseKind)}
              >
                <option value="vulnerability">Actively exploited vulnerability</option>
                <option value="incident">Severe incident</option>
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-product">Product</Label>
              <select
                id="case-product"
                required
                className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                value={productId}
                onChange={(e) => setProductId(e.target.value)}
              >
                <option value="">Choose a product</option>
                {(products.data ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="case-aware">Became aware at (your local time)</Label>
              <Input
                id="case-aware"
                type="datetime-local"
                required
                max={localNow()}
                value={awareAt}
                onChange={(e) => setAwareAt(e.target.value)}
              />
            </div>
            <div className="sm:col-span-2">
              <Button type="submit" disabled={busy}>
                Open case and start clocks
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {cases.loading && !cases.data ? <Skeleton className="h-24 w-full" /> : null}
      {cases.error ? <p className="text-sm text-destructive">{cases.error.message}</p> : null}
      {cases.data?.length === 0 ? <EmptyState title="No cases" description="Nothing is on the clock." /> : null}
      <div className="space-y-3">
        {(cases.data ?? []).map((c: PublicDeskCase) => (
          <Card key={c.id}>
            <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle className="text-base">
                  <Link className="underline" href={`/orgs/${orgSlug}/desk/cases/${c.id}`}>
                    {c.title}
                  </Link>
                </CardTitle>
                <CardDescription>
                  {c.kind === "vulnerability" ? "Actively exploited vulnerability" : "Severe incident"}
                  {c.status === "open" ? ` · early warning ${remaining(c.earlyWarningDueAt, now)}` : ""}
                </CardDescription>
              </div>
              <div className="flex gap-2">
                {c.status === "open" && !c.acknowledgedAt ? <Badge variant="destructive">Not acknowledged</Badge> : null}
                <Badge variant="secondary">{c.status}</Badge>
              </div>
            </CardHeader>
          </Card>
        ))}
      </div>
    </div>
  );
}
