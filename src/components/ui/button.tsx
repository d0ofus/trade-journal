import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-xl text-sm font-medium shadow-sm disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-300/70 focus-visible:ring-offset-2 focus-visible:ring-offset-transparent",
  {
    variants: {
      variant: {
        default:
          "bg-[linear-gradient(135deg,#0f172a,#155e75)] text-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-sky-950/20",
        outline:
          "border border-slate-200/80 bg-white/80 text-slate-700 backdrop-blur hover:-translate-y-0.5 hover:border-slate-300 hover:bg-white",
        ghost: "text-slate-600 hover:bg-slate-900/5 hover:text-slate-900",
        destructive: "bg-[linear-gradient(135deg,#dc2626,#b91c1c)] text-white hover:-translate-y-0.5 hover:shadow-lg hover:shadow-red-950/20",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-11 px-6 text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return <button className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
