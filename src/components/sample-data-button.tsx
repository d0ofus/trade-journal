"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function SampleDataButton() {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  const onClick = () => {
    startTransition(async () => {
      await fetch("/api/sample-data", { method: "POST" });
      router.refresh();
    });
  };

  return (
    <Button onClick={onClick} variant="outline" disabled={pending}>
      {pending ? "Loading demo..." : "Sample Data"}
    </Button>
  );
}
