import type React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center rounded-full px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]", {
  variants: {
    variant: {
      default: "bg-slate-900 text-white",
      success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200",
      danger: "bg-red-50 text-red-700 ring-1 ring-red-200",
      outline: "border border-slate-200 bg-white text-slate-700",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
