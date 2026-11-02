"use client";

import * as React from "react";
import { useParams } from "next/navigation";
import { useQueryClient } from "@tanstack/react-query";
import { EU_MEMBER_STATES, type PublicDeskProduct } from "@saas/contracts/desk";
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

export default function DeskProductsPage() {
  const params = useParams<{ orgSlug: string }>();
  return <OrgScope slug={params?.orgSlug ?? ""}>{(org) => <Inner orgId={org.id} />}</OrgScope>;
}

function Inner({ orgId }: { orgId: string }) {
  const { client } = useSession();
  const { toast } = useToast();
  const qc = useQueryClient();
  const products = useApiQuery(qk.deskProducts(orgId), () =>
    wrap(async () => (await client.desk.listProducts(orgId)).products),
  );
  const [name, setName] = React.useState("");
  const [supportEndsOn, setSupportEndsOn] = React.useState("");
  const [states, setStates] = React.useState<string[]>([]);
  const [busy, setBusy] = React.useState(false);

  const refresh = () => {
    void qc.invalidateQueries({ queryKey: qk.deskProducts(orgId) });
    void qc.invalidateQueries({ queryKey: qk.deskReadiness(orgId) });
  };

  const toggle = (code: string) =>
    setStates((current) => (current.includes(code) ? current.filter((c) => c !== code) : [...current, code]));

  const create = async (event: React.FormEvent) => {
    event.preventDefault();
    setBusy(true);
    const result = await wrap(() =>
      client.desk.createProduct(orgId, { name, memberStates: states, supportEndsOn: supportEndsOn || null }),
    );
    setBusy(false);
    if (result.ok) {
      setName("");
      setStates([]);
      setSupportEndsOn("");
      refresh();
    } else {
      toast({ kind: "error", title: "Could not add the product", description: result.error.message });
    }
  };

  const remove = async (product: PublicDeskProduct) => {
    const result = await wrap(() => client.desk.deleteProduct(orgId, product.id));
    if (result.ok) refresh();
    else toast({ kind: "error", title: "Could not remove the product", description: result.error.message });
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Products</h1>
        <p className="text-sm text-muted-foreground">
          The products you report on, and the Member States where each is available.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Add a product</CardTitle>
        </CardHeader>
        <CardContent>
          <form className="space-y-4" onSubmit={(e) => void create(e)}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="product-name">Name</Label>
                <Input id="product-name" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="product-support">Support ends on</Label>
                <Input
                  id="product-support"
                  type="date"
                  value={supportEndsOn}
                  onChange={(e) => setSupportEndsOn(e.target.value)}
                />
              </div>
            </div>
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Available in</legend>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" onClick={() => setStates([...EU_MEMBER_STATES])}>
                  All 27
                </Button>
                {EU_MEMBER_STATES.map((code) => (
                  <Button
                    key={code}
                    type="button"
                    size="sm"
                    aria-pressed={states.includes(code)}
                    variant={states.includes(code) ? "default" : "outline"}
                    onClick={() => toggle(code)}
                  >
                    {code}
                  </Button>
                ))}
              </div>
            </fieldset>
            <Button type="submit" disabled={busy}>
              Add product
            </Button>
          </form>
        </CardContent>
      </Card>

      {products.loading && !products.data ? <Skeleton className="h-24 w-full" /> : null}
      {products.error ? <p className="text-sm text-destructive">{products.error.message}</p> : null}
      {products.data?.length === 0 ? (
        <EmptyState title="No products yet" description="Add the first product you sell in the EU." />
      ) : null}
      <div className="space-y-3">
        {(products.data ?? []).map((product) => (
          <Card key={product.id}>
            <CardHeader className="flex flex-row items-start justify-between space-y-0">
              <div>
                <CardTitle className="text-base">{product.name}</CardTitle>
                <CardDescription>
                  {product.supportEndsOn ? `Support ends ${product.supportEndsOn}` : "No support end date"}
                </CardDescription>
              </div>
              <Button variant="ghost" size="sm" onClick={() => void remove(product)}>
                Remove
              </Button>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-1">
              {product.memberStates.length === 0 ? <Badge variant="secondary">No markets</Badge> : null}
              {product.memberStates.map((code) => (
                <Badge key={code} variant="outline">
                  {code}
                </Badge>
              ))}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
