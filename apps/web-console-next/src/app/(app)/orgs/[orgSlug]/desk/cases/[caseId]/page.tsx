"use client";

import * as React from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap, type ApiResult } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

export default function DeskCasePage() {
  const params = useParams<{ orgSlug: string; caseId: string }>();
  return (
    <OrgScope slug={params?.orgSlug ?? ""}>
      {(org) => <Inner orgId={org.id} orgSlug={org.slug} caseId={params?.caseId ?? ""} />}
    </OrgScope>
  );
}

function left(dueAt: string | null, now: number): string {
  if (!dueAt) return "Starts later";
  const ms = new Date(dueAt).getTime() - now;
  const abs = Math.abs(ms);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const span = hours >= 48 ? `${Math.floor(hours / 24)} days` : `${hours} h ${minutes} min`;
  return ms < 0 ? `${span} overdue` : `${span} left`;
}

function Inner({ orgId, orgSlug, caseId }: { orgId: string; orgSlug: string; caseId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const key = qk.deskCase(orgId, caseId);
  const detail = useApiQuery(key, () => wrap(() => client.desk.getCase(orgId, caseId)));
  const [note, setNote] = React.useState("");
  const [fixAt, setFixAt] = React.useState("");
  const [fixText, setFixText] = React.useState("");
  const [closeReason, setCloseReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [now, setNow] = React.useState(() => Date.now());

  React.useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(timer);
  }, []);

  const run = async (action: () => Promise<ApiResult<unknown>>, done?: () => void) => {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) {
      done?.();
      void qc.invalidateQueries({ queryKey: key });
      void qc.invalidateQueries({ queryKey: qk.deskCases(orgId) });
    } else {
      toast({ kind: "error", title: "That did not save", description: result.error.message });
    }
  };

  if (detail.loading && !detail.data) return <Skeleton className="h-64 w-full" />;
  if (detail.error) return <p className="text-sm text-destructive">{detail.error.message}</p>;
  if (!detail.data) return null;
  const { case: c, events, chainValid } = detail.data;
  const open = c.status === "open";
  const downloadEvidence = async () => {
    setBusy(true);
    const result = await wrap(() => client.desk.exportEvidence(orgId, caseId));
    setBusy(false);
    if (!result.ok) {
      toast({ kind: "error", title: "Could not export", description: result.error.message });
      return;
    }
    const url = URL.createObjectURL(new Blob([JSON.stringify(result.data, null, 2)], { type: "application/json" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `earlywarn-evidence-${caseId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };
  const clocks = [
    { label: "Early warning", due: c.earlyWarningDueAt },
    { label: "Notification", due: c.notificationDueAt },
    { label: "Final report", due: c.finalDueAt },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{c.title}</h1>
          <p className="text-sm text-muted-foreground">
            Aware since {new Date(c.awareAt).toLocaleString()}, recorded by {c.awareRecordedBy}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{c.status}</Badge>
          <Button variant="outline" asChild>
            <Link href={`/orgs/${orgSlug}/desk/cases/${caseId}/packet`}>Reports to file</Link>
          </Button>
          <Button variant="outline" disabled={busy} onClick={() => void downloadEvidence()}>
            Export evidence
          </Button>
          {c.acknowledgedAt ? (
            <Badge variant="outline">Acknowledged</Badge>
          ) : (
            <Button disabled={busy} onClick={() => void run(() => wrap(() => client.desk.acknowledgeCase(orgId, caseId)))}>
              Acknowledge
            </Button>
          )}
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {clocks.map(({ label, due }) => (
          <Card key={label}>
            <CardHeader>
              <CardDescription>{label}</CardDescription>
              <CardTitle className="text-lg">{open ? left(due, now) : "Case closed"}</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              {due ? new Date(due).toLocaleString() : c.kind === "vulnerability" ? "14 days after a fix is available" : "One month after the notification"}
            </CardContent>
          </Card>
        ))}
      </div>

      {open ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {c.kind === "vulnerability" ? (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Corrective measure</CardTitle>
                <CardDescription>Starts the final report&apos;s 14 days.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="fix-at">Available since</Label>
                  <Input id="fix-at" type="datetime-local" value={fixAt} onChange={(e) => setFixAt(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="fix-text">What is it?</Label>
                  <Textarea id="fix-text" rows={3} value={fixText} onChange={(e) => setFixText(e.target.value)} />
                </div>
                <Button
                  variant="outline"
                  disabled={busy || !fixAt || !fixText.trim()}
                  onClick={() =>
                    void run(() =>
                      wrap(() =>
                        client.desk.recordCorrectiveMeasure(orgId, caseId, new Date(fixAt).toISOString(), fixText),
                      ),
                    )
                  }
                >
                  Record
                </Button>
              </CardContent>
            </Card>
          ) : null}
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Add a note</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <Textarea rows={3} aria-label="Note" value={note} onChange={(e) => setNote(e.target.value)} />
              <Button
                variant="outline"
                disabled={busy || !note.trim()}
                onClick={() => void run(() => wrap(() => client.desk.addCaseNote(orgId, caseId, note)), () => setNote(""))}
              >
                Add to timeline
              </Button>
              <div className="space-y-1.5 border-t pt-3">
                <Label htmlFor="close-reason">Close this case</Label>
                <Input id="close-reason" placeholder="Reason" value={closeReason} onChange={(e) => setCloseReason(e.target.value)} />
                <Button
                  variant="outline"
                  disabled={busy || !closeReason.trim()}
                  onClick={() => void run(() => wrap(() => client.desk.closeCase(orgId, caseId, closeReason)))}
                >
                  Close case
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">Timeline</CardTitle>
          <Badge variant={chainValid ? "outline" : "destructive"}>
            {chainValid ? "Chain verified" : "Chain broken: this record has been altered"}
          </Badge>
        </CardHeader>
        <CardContent>
          <ol className="space-y-3">
            {events.map((event) => (
              <li key={event.seq} className="text-sm">
                <p className="font-medium">{event.type}</p>
                <p className="text-muted-foreground">
                  {new Date(event.occurredAt).toLocaleString()} · {event.actor}
                </p>
                {typeof event.payload.note === "string" ? <p className="whitespace-pre-wrap">{event.payload.note}</p> : null}
                {typeof event.payload.reason === "string" ? <p>{event.payload.reason}</p> : null}
                {typeof event.payload.description === "string" ? <p>{event.payload.description}</p> : null}
              </li>
            ))}
          </ol>
        </CardContent>
      </Card>
    </div>
  );
}
