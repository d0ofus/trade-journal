import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { ApplicationShell } from "@/components/application-shell";
import { authOptions } from "@/lib/auth";
import { SyntheticStorageCleanup } from "@/components/synthetic-storage-cleanup";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <ApplicationShell>{process.env.VERCEL_ENV === "production" && <SyntheticStorageCleanup />}{children}</ApplicationShell>
  );
}
