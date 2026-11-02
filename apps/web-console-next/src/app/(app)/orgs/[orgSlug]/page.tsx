import { redirect } from "next/navigation";
import { SOLO_MODE } from "@/lib/solo-mode";

export default function OrgRoot({ params }: { params: { orgSlug: string } }) {
  // The org root resolves to the profile's home surface. Team → the reporting desk;
  // Solo → the Account (settings) surface, since projects are suppressed.
  redirect(`/orgs/${params.orgSlug}/${SOLO_MODE ? "settings" : "desk"}`);
}
