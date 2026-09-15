import { cva } from "class-variance-authority"

export const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-body font-semibold shadow-sm transition-[background-color,color,box-shadow] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring aria-pressed:bg-primary aria-pressed:text-primary-foreground disabled:pointer-events-none disabled:bg-muted disabled:text-disabled-foreground disabled:shadow-none",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground hover:bg-primary/90 data-[pressed]:bg-primary/80",
        secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 data-[pressed]:bg-secondary/70",
        outline: "border border-input bg-background hover:bg-accent hover:text-accent-foreground data-[pressed]:bg-accent data-[pressed]:text-accent-foreground",
        ghost: "shadow-none hover:bg-accent hover:text-accent-foreground data-[pressed]:bg-accent data-[pressed]:text-accent-foreground",
        destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 data-[pressed]:bg-destructive/80",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
        lg: "h-11 px-8",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
)
