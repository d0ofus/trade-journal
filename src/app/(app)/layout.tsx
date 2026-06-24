import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { Sidebar } from "@/components/sidebar";
import { authOptions } from "@/lib/auth";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session) {
    redirect("/login");
  }

  return (
    <div className="flex min-h-screen w-full bg-[#f5f7fb] text-slate-950">
      <Sidebar />
      <main className="min-w-0 flex-1 px-4 pb-8 pt-28 sm:px-5 lg:px-5 lg:pt-0">{children}</main>
    </div>
  );
}
