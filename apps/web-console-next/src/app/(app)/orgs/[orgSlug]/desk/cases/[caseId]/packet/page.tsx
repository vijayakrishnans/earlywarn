"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { DeskPacket } from "@saas/contracts/desk";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CopyButton } from "@/components/ui/copy-button";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

const STAGES = [
  { id: "early_warning", label: "Early warning" },
  { id: "notification", label: "Notification" },
  { id: "final", label: "Final report" },
] as const;
type Stage = (typeof STAGES)[number]["id"];

const SRP_PORTAL = "https://portal.cra-srp.enisa.europa.eu/";

export default function PacketPage() {
  const params = useParams<{ orgSlug: string; caseId: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} caseId={params?.caseId ?? ""} />}</OrgScope>;
}

function Inner({ orgId, caseId }: { orgId: string; caseId: string }) {
  const [stage, setStage] = React.useState<Stage>("early_warning");
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Reports to file</h1>
        <p className="text-sm text-muted-foreground">
          Earlywarn does not file for you. Check each value, enter it in{" "}
          <a className="underline" href={SRP_PORTAL} target="_blank" rel="noreferrer">
            ENISA&apos;s Single Reporting Platform
          </a>
          , then record it here. The platform&apos;s own form is the authority if it differs.
        </p>
      </div>
      <div className="flex flex-wrap gap-2" role="group" aria-label="Reporting stage">
        {STAGES.map((s) => (
          <Button
            key={s.id}
            variant={stage === s.id ? "default" : "outline"}
            aria-pressed={stage === s.id}
            onClick={() => setStage(s.id)}
          >
            {s.label}
          </Button>
        ))}
      </div>
      <StagePacket key={stage} orgId={orgId} caseId={caseId} stage={stage} />
    </div>
  );
}

function StagePacket({ orgId, caseId, stage }: { orgId: string; caseId: string; stage: Stage }) {
  const { client } = useSession();
  const key = qk.deskPacket(orgId, caseId, stage);
  const packet = useApiQuery(key, () => wrap(async () => (await client.desk.getPacket(orgId, caseId, stage)).packet));
  if (packet.loading && !packet.data) return <Skeleton className="h-64 w-full" />;
  if (packet.error) return <p className="text-sm text-destructive">{packet.error.message}</p>;
  return packet.data ? <PacketForm orgId={orgId} caseId={caseId} packet={packet.data} /> : null;
}

function PacketForm({ orgId, caseId, packet }: { orgId: string; caseId: string; packet: DeskPacket }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [values, setValues] = React.useState<Record<string, string>>(() =>
    Object.fromEntries(packet.fields.map((f) => [f.id, f.value ?? ""])),
  );
  const [submittedAt, setSubmittedAt] = React.useState("");
  const [reference, setReference] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const done = !!packet.submitted;
  const missing = packet.fields.filter((f) => f.requirement === "required" && !values[f.id]?.trim());

  const record = async () => {
    setBusy(true);
    const result = await wrap(() =>
      client.desk.recordSubmission(orgId, caseId, {
        stage: packet.stage,
        fields: values,
        submittedAt: new Date(submittedAt).toISOString(),
        srpReference: reference || null,
      }),
    );
    setBusy(false);
    if (result.ok) {
      toast({ kind: "success", title: "Recorded on the timeline" });
      void qc.invalidateQueries({ queryKey: qk.deskPacket(orgId, caseId, packet.stage) });
      void qc.invalidateQueries({ queryKey: qk.deskCase(orgId, caseId) });
    } else {
      toast({ kind: "error", title: "Could not record it", description: result.error.message });
    }
  };

  return (
    <div className="space-y-4">
      {packet.blockedBy ? (
        <p className="text-sm text-destructive">
          The platform requires the {packet.blockedBy.replace("_", " ")} to be submitted first.
        </p>
      ) : null}
      <Card>
        <CardHeader className="flex flex-row items-start justify-between space-y-0">
          <div>
            <CardTitle className="text-base">Fields</CardTitle>
            <CardDescription>
              {packet.dueAt ? `Due ${new Date(packet.dueAt).toLocaleString()}` : "Deadline starts later"} · SRP fields{" "}
              {packet.catalogVersion}
            </CardDescription>
          </div>
          {done ? (
            <Badge variant="outline">Recorded</Badge>
          ) : (
            <Badge variant={missing.length > 0 ? "destructive" : "secondary"}>
              {missing.length > 0 ? `${missing.length} required missing` : "Ready to enter"}
            </Badge>
          )}
        </CardHeader>
        <CardContent className="space-y-4">
          {packet.fields.map((f) => (
            <div key={f.id} className="space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor={`srp-${f.id}`}>
                  {f.id}. {f.label}
                  {f.requirement === "required" ? " (required)" : ""}
                </Label>
                {values[f.id] ? <CopyButton value={values[f.id]!} /> : null}
              </div>
              <Textarea
                id={`srp-${f.id}`}
                rows={2}
                disabled={done}
                value={values[f.id] ?? ""}
                onChange={(e) => setValues((current) => ({ ...current, [f.id]: e.target.value }))}
              />
              {f.note ? <p className="text-xs text-muted-foreground">{f.note}</p> : null}
            </div>
          ))}
        </CardContent>
      </Card>
      {done ? (
        <p className="text-sm text-muted-foreground">
          Filed {new Date(packet.submitted!.submittedAt).toLocaleString()}, recorded by {packet.submitted!.submittedBy}.
        </p>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Record the filing</CardTitle>
            <CardDescription>Only after you have submitted it in the platform.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="srp-at">Submitted at (your local time)</Label>
              <Input id="srp-at" type="datetime-local" value={submittedAt} onChange={(e) => setSubmittedAt(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="srp-ref">Reference from the platform (optional)</Label>
              <Input id="srp-ref" maxLength={200} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Button disabled={busy || !submittedAt || missing.length > 0 || !!packet.blockedBy} onClick={() => void record()}>
                Record as filed
              </Button>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
