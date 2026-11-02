"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import type { DeskReportStatus, DeskReportSummary, PublicDeskReport } from "@saas/contracts/desk";
import { OrgScope } from "@/components/shell/org-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/components/ui/toast";
import { wrap } from "@/lib/api";
import { qk, useApiQuery } from "@/lib/query";
import { useSession } from "@/lib/session";

export default function DeskReportsPage() {
  const params = useParams<{ orgSlug: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

function age(receivedAt: string, now: number): { label: string; minutes: number } {
  const minutes = Math.max(0, Math.floor((now - new Date(receivedAt).getTime()) / 60000));
  const label = minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.floor(minutes / 60)} h` : `${Math.floor(minutes / 1440)} days`;
  return { label, minutes };
}

function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const list = useApiQuery(qk.deskReports(orgId), () => wrap(() => client.desk.listReports(orgId)));
  const now = Date.now();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Triage</h1>
        <p className="text-sm text-muted-foreground">
          Reports from your disclosure page. A report starts no legal clock by itself: decide whether it is actively
          exploited or a severe incident, and take advice where you are unsure. Opening a report is recorded in the audit
          log.
        </p>
      </div>
      {list.loading && !list.data ? <Skeleton className="h-32 w-full" /> : null}
      {list.error ? <p className="text-sm text-destructive">{list.error.message}</p> : null}
      {list.data?.reports.length === 0 ? (
        <EmptyState title="No reports yet" description="Reports sent through your disclosure page appear here." />
      ) : null}
      <div className="space-y-3">
        {(list.data?.reports ?? []).map((report) => (
          <ReportCard
            key={report.id}
            orgId={orgId}
            report={report}
            age={age(report.receivedAt, now)}
            target={list.data!.triageTargetMinutes}
          />
        ))}
      </div>
    </div>
  );
}

function ReportCard({
  orgId,
  report,
  age: reportAge,
  target,
}: {
  orgId: string;
  report: DeskReportSummary;
  age: { label: string; minutes: number };
  target: number;
}) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [opened, setOpened] = React.useState<PublicDeskReport | null>(null);
  const [busy, setBusy] = React.useState(false);
  const late = report.status === "new" && reportAge.minutes > target;

  const open = async () => {
    setBusy(true);
    const result = await wrap(() => client.desk.getReport(orgId, report.id));
    setBusy(false);
    if (result.ok) setOpened(result.data.report);
    else toast({ kind: "error", title: "Could not open the report", description: result.error.message });
  };

  const setStatus = async (status: DeskReportStatus) => {
    setBusy(true);
    const result = await wrap(() => client.desk.setReportStatus(orgId, report.id, status));
    setBusy(false);
    if (result.ok) {
      setOpened(result.data.report);
      void qc.invalidateQueries({ queryKey: qk.deskReports(orgId) });
    } else {
      toast({ kind: "error", title: "Could not update the report", description: result.error.message });
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 space-y-0">
        <div>
          <CardTitle className="text-base">{report.title}</CardTitle>
          <CardDescription>
            {report.product ?? "No product named"} · received {reportAge.label} ago
          </CardDescription>
        </div>
        <div className="flex gap-2">
          {late ? <Badge variant="destructive">Past triage target</Badge> : null}
          <Badge variant={report.status === "new" ? "default" : "secondary"}>{report.status}</Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {opened ? (
          <>
            <p className="whitespace-pre-wrap text-sm">{opened.details}</p>
            <p className="text-sm text-muted-foreground">Reporter: {opened.reporterContact ?? "not given"}</p>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy} onClick={() => void setStatus("triaged")}>
                Mark triaged
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus("duplicate")}>
                Duplicate
              </Button>
              <Button size="sm" variant="outline" disabled={busy} onClick={() => void setStatus("rejected")}>
                Reject
              </Button>
            </div>
          </>
        ) : (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void open()}>
            Open report
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
