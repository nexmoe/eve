import * as ScrollAreaPrimitive from "@radix-ui/react-scroll-area";
import { cn } from "@/lib/cn";

export function ScrollArea({
  className,
  children,
  ...props
}: ScrollAreaPrimitive.ScrollAreaProps) {
  return (
    <ScrollAreaPrimitive.Root
      className={cn("relative w-full overflow-hidden", className)}
      {...props}
    >
      <ScrollAreaPrimitive.Viewport className="h-full w-full overflow-x-hidden rounded-[inherit] [&>div]:!block [&>div]:!w-full [&>div]:!min-w-0 [&>div]:!max-w-full">
        <div className="min-h-full w-full min-w-0 max-w-full">{children}</div>
      </ScrollAreaPrimitive.Viewport>
      <ScrollBar orientation="vertical" />
      <ScrollAreaPrimitive.Corner />
    </ScrollAreaPrimitive.Root>
  );
}

function ScrollBar({
  className,
  orientation = "vertical",
  ...props
}: ScrollAreaPrimitive.ScrollAreaScrollbarProps) {
  return (
    <ScrollAreaPrimitive.Scrollbar
      className={cn(
        "flex touch-none select-none p-1 transition-colors",
        orientation === "vertical" && "absolute inset-y-0 right-0 w-3.5",
        orientation === "horizontal" && "absolute inset-x-0 bottom-0 h-3.5 flex-col",
        className
      )}
      orientation={orientation}
      {...props}
    >
      <ScrollAreaPrimitive.Thumb className="relative flex-1 rounded-full bg-[color:var(--border)]/80" />
    </ScrollAreaPrimitive.Scrollbar>
  );
}
