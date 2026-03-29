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
    <div className="mx-auto flex min-h-screen w-full max-w-[1680px] gap-6 px-4 py-4 sm:px-6 sm:py-6 lg:gap-8 lg:px-8">
      <Sidebar />
      <main className="min-w-0 flex-1 pb-10 pt-28 lg:pt-2">{children}</main>
    </div>
  );
}
