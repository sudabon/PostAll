import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"
import { m } from "motion/react"

import { cn } from "@/lib/utils"
import { usePressable } from "@/lib/motion/usePressable"
import { springPresets } from "@/lib/motion/springs"

type MotionButtonBaseProps = Omit<
  React.ComponentProps<"button">,
  "onAnimationStart" | "onDrag" | "onDragStart" | "onDragEnd"
> & {
  nativeOnAnimationStart?: React.ComponentProps<"button">["onAnimationStart"]
  nativeOnDrag?: React.ComponentProps<"button">["onDrag"]
  nativeOnDragStart?: React.ComponentProps<"button">["onDragStart"]
  nativeOnDragEnd?: React.ComponentProps<"button">["onDragEnd"]
}

const MotionButtonBase = React.forwardRef<HTMLButtonElement, MotionButtonBaseProps>(({
  nativeOnAnimationStart,
  nativeOnDrag,
  nativeOnDragStart,
  nativeOnDragEnd,
  ...props
}, ref) => (
  <button
    ref={ref}
    onAnimationStart={nativeOnAnimationStart}
    onDrag={nativeOnDrag}
    onDragStart={nativeOnDragStart}
    onDragEnd={nativeOnDragEnd}
    {...props}
  />
))
MotionButtonBase.displayName = "MotionButtonBase"
const MotionButton = m.create(MotionButtonBase)

const buttonVariants = cva(
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

export type ButtonProps = React.ComponentProps<"button"> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean
  }

function Button({
  className,
  variant,
  size,
  asChild = false,
  disabled,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onLostPointerCapture,
  onAnimationStart,
  onDrag,
  onDragStart,
  onDragEnd,
  ...props
}: ButtonProps) {
  const { isPressed, shouldReduceMotion, pressProps } = usePressable<HTMLButtonElement>({
    disabled,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
  })
  const sharedProps = {
    "data-slot": "button",
    className: cn(buttonVariants({ variant, size, className })),
    disabled,
    ...props,
    ...pressProps,
  }

  if (asChild) {
    return (
      <Slot
        {...sharedProps}
        onAnimationStart={onAnimationStart}
        onDrag={onDrag}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
      />
    )
  }

  return (
    <MotionButton
      {...sharedProps}
      nativeOnAnimationStart={onAnimationStart}
      nativeOnDrag={onDrag}
      nativeOnDragStart={onDragStart}
      nativeOnDragEnd={onDragEnd}
      animate={shouldReduceMotion
        ? { opacity: isPressed ? 0.78 : 1 }
        : { scale: isPressed ? 0.97 : 1 }}
      transition={shouldReduceMotion ? { duration: 0.1 } : springPresets.snap}
    />
  )
}

export { Button, buttonVariants }
