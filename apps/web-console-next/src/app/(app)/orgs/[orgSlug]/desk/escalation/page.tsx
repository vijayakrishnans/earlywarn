"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { EscalationStepInput } from "@saas/contracts/desk";
import { OrgScope } from "@/components/shell/org-scope";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

const blankStep = (): EscalationStepInput => ({ name: "", email: "", afterMinutes: 30, channels: ["email"] });

export default function DeskEscalationPage() {
  const params = useParams<{ orgSlug: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const chain = useApiQuery(qk.deskEscalation(orgId), () =>
    wrap(async () => (await client.desk.getEscalation(orgId)).steps),
  );
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Escalation</h1>
        <p className="text-sm text-muted-foreground">
          Who is alerted, in order, until someone acknowledges. The first person is your primary representative; the
          next is your backup.
        </p>
      </div>
      {chain.loading && !chain.data ? <Skeleton className="h-40 w-full" /> : null}
      {chain.error ? <p className="text-sm text-destructive">{chain.error.message}</p> : null}
      {chain.data ? (
        <ChainForm
          orgId={orgId}
          initial={chain.data.map(({ name, email, afterMinutes, channels }) => ({ name, email, afterMinutes, channels }))}
        />
      ) : null}
    </div>
  );
}

function ChainForm({ orgId, initial }: { orgId: string; initial: EscalationStepInput[] }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [steps, setSteps] = React.useState<EscalationStepInput[]>(
    initial.length > 0 ? initial : [blankStep(), blankStep()],
  );
  const [busy, setBusy] = React.useState(false);

  const update = (index: number, patch: Partial<EscalationStepInput>) =>
    setSteps((current) => current.map((step, i) => (i === index ? { ...step, ...patch } : step)));

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await wrap(() => client.desk.saveEscalation(orgId, steps));
    setBusy(false);
    if (result.ok) {
      toast({ kind: "success", title: "Escalation chain saved" });
      void qc.invalidateQueries({ queryKey: qk.deskEscalation(orgId) });
      void qc.invalidateQueries({ queryKey: qk.deskReadiness(orgId) });
    } else {
      toast({ kind: "error", title: "Could not save the chain", description: result.error.message });
    }
  };

  return (
    <form className="space-y-4" onSubmit={(e) => void save(e)}>
      {steps.map((step, index) => (
        <Card key={index}>
          <CardHeader className="flex flex-row items-start justify-between space-y-0">
            <div>
              <CardTitle className="text-base">{index === 0 ? "Primary" : `Backup ${index}`}</CardTitle>
              <CardDescription>
                {index === 0 ? "Alerted immediately." : "Alerted if the previous person has not acknowledged."}
              </CardDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setSteps((current) => current.filter((_, i) => i !== index))}
            >
              Remove
            </Button>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor={`step-name-${index}`}>Name</Label>
              <Input
                id={`step-name-${index}`}
                required
                value={step.name}
                onChange={(e) => update(index, { name: e.target.value })}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={`step-email-${index}`}>Email</Label>
              <Input
                id={`step-email-${index}`}
                type="email"
                required
                value={step.email}
                onChange={(e) => update(index, { email: e.target.value })}
              />
            </div>
            {index > 0 ? (
              <div className="space-y-1.5">
                <Label htmlFor={`step-after-${index}`}>Wait (minutes)</Label>
                <Input
                  id={`step-after-${index}`}
                  type="number"
                  min={0}
                  max={1440}
                  required
                  value={step.afterMinutes}
                  onChange={(e) => update(index, { afterMinutes: Number(e.target.value) })}
                />
              </div>
            ) : null}
          </CardContent>
        </Card>
      ))}
      <div className="flex gap-2">
        <Button type="button" variant="outline" onClick={() => setSteps((current) => [...current, blankStep()])}>
          Add a person
        </Button>
        <Button type="submit" disabled={busy}>
          Save chain
        </Button>
      </div>
    </form>
  );
}
