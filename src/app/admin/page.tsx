import { redirect } from "next/navigation";

import { requireAdmin } from "@/lib/auth/profile";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  await requireAdmin();
  redirect("/admin/users");
}

