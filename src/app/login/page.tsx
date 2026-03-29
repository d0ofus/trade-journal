"use client";

import { FormEvent, useState } from "react";
import { LineChart } from "lucide-react";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const callbackUrl = "/dashboard";
    const result = await signIn("credentials", {
      username,
      password,
      redirect: false,
      callbackUrl,
    });

    if (result?.error) {
      setError("Invalid credentials.");
      setLoading(false);
      return;
    }

    window.location.href = callbackUrl;
  }

  return (
    <main className="flex min-h-screen items-center justify-center px-6 py-10">
      <div className="grid w-full max-w-6xl gap-6 lg:grid-cols-[minmax(0,1.15fr)_420px]">
        <section className="relative hidden overflow-hidden rounded-[32px] border border-white/12 bg-[linear-gradient(135deg,rgba(15,23,42,0.96),rgba(15,118,110,0.86)_58%,rgba(56,189,248,0.8))] p-10 text-white shadow-[0_30px_90px_-34px_rgba(15,23,42,0.8)] lg:block">
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_right,rgba(255,255,255,0.18),transparent_30%),radial-gradient(circle_at_bottom_left,rgba(255,255,255,0.12),transparent_24%)]" />
          <div className="relative max-w-xl space-y-6">
            <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-white/14 bg-white/10">
              <LineChart className="h-7 w-7" />
            </div>
            <div className="space-y-3">
              <p className="text-[11px] font-semibold uppercase tracking-[0.28em] text-white/65">Execution Lab</p>
              <h1 className="text-4xl font-semibold tracking-tight">A trade journal that finally looks product-grade.</h1>
              <p className="max-w-lg text-base leading-7 text-sky-50/82">
                Review imports, execution quality, and performance analytics inside a cleaner professional workspace.
              </p>
            </div>
          </div>
        </section>

        <Card className="w-full">
          <CardHeader className="pb-4">
            <CardTitle className="text-2xl">Sign In</CardTitle>
            <CardDescription>Use the local credentials from your `.env` file.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <Input
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                placeholder="Username"
                autoComplete="username"
              />
              <Input
                type="password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="Password"
                autoComplete="current-password"
              />
              {error && <p className="text-sm text-red-600">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? "Signing in..." : "Sign In"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
