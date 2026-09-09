import "server-only";

import { redirect } from "next/navigation";

import { getProfileAccess } from "@/lib/auth/profile-access";
import { createClient } from "@/lib/supabase/server";
import type { Profile } from "@/types/database";

export interface AuthenticatedProfile {
  user: {
    id: string;
    email: string;
  };
  profile: Profile;
}

export async function getAuthenticatedProfile(): Promise<AuthenticatedProfile | null> {
  const supabase = await createClient();
  const { data: claimsData, error: claimsError } =
    await supabase.auth.getClaims();
  const userId = claimsData?.claims?.sub;

  if (claimsError || !userId) {
    return null;
  }

  const { data: profile, error: profileError } = await supabase
    .from("profiles")
    .select("id, name, email, role, active, created_at")
    .eq("id", userId)
    .maybeSingle();

  if (profileError || !profile) {
    return null;
  }

  const claimEmail = claimsData.claims.email;

  return {
    user: {
      id: userId,
      email: typeof claimEmail === "string" ? claimEmail : profile.email,
    },
    profile,
  };
}

export async function requireActiveProfile(): Promise<AuthenticatedProfile> {
  const authenticatedProfile = await getAuthenticatedProfile();

  if (!authenticatedProfile) {
    redirect("/login");
  }

  const access = getProfileAccess(authenticatedProfile.profile);

  if (access === "inactive") {
    redirect("/login?reason=inactive");
  }

  if (access !== "allowed") {
    redirect("/login?reason=access");
  }

  return authenticatedProfile;
}

export async function requireAdmin(): Promise<AuthenticatedProfile> {
  const authenticatedProfile = await requireActiveProfile();

  if (authenticatedProfile.profile.role !== "admin") {
    redirect("/dashboard");
  }

  return authenticatedProfile;
}
