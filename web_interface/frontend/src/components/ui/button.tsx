import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-[var(--primary)] text-white hover:bg-[var(--primary)]/90",
        destructive: "bg-[var(--danger)] text-white hover:bg-[var(--danger)]/90",
        outline: "border border-[var(--border)] bg-transparent hover:bg-[var(--accent)]",
        secondary: "bg-[var(--secondary)] text-white hover:bg-[var(--secondary)]/80",
        ghost: "hover:bg-[var(--accent)]",
        success: "bg-[#2a5a3a] text-[var(--success)] hover:bg-[#2a5a3a]/90",
        warning: "bg-[#5a4a2a] text-[var(--warning)] hover:bg-[#5a4a2a]/90",
      },
      size: {
        default: "h-9 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-10 rounded-md px-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, ...props }, ref) => {
    return (
      <button
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    )
  }
)
Button.displayName = "Button"

export { Button, buttonVariants }
