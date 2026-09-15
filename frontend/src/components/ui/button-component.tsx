import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import type { VariantProps } from "class-variance-authority"
import { m } from "motion/react"

import { cn } from "@/lib/utils"
import { usePressable } from "@/lib/motion/usePressable"
import { springPresets } from "@/lib/motion/springs"
import { buttonVariants } from "./button-variants"

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
  onClick,
  ...props
}: ButtonProps) {
  // iOS ではタップ後に合成 click が飛んでこないことがある（押下フィードバックだけ出て
  // 何も起きない）。タッチは pointerup で直接発火させ、その後に click が来た場合は
  // 二重実行にならないよう読み捨てる。
  const activatedAt = React.useRef(0)
  const { isPressed, shouldReduceMotion, pressProps } = usePressable<HTMLButtonElement>({
    disabled,
    onPointerDown,
    onPointerMove,
    onPointerUp,
    onPointerCancel,
    onLostPointerCapture,
    onPress: (event) => {
      if (event.pointerType !== "touch" || !onClick) return
      activatedAt.current = event.timeStamp
      onClick(event)
    },
  })
  const handleClick = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (activatedAt.current && event.timeStamp - activatedAt.current < 700) return
    onClick?.(event)
  }
  const sharedProps = {
    "data-slot": "button",
    className: cn(buttonVariants({ variant, size, className })),
    disabled,
    ...props,
    ...pressProps,
    onClick: handleClick,
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

export { Button }
