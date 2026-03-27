import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cn } from "@/lib/cn";

export const Tabs = TabsPrimitive.Root;

export function TabsList({
  className,
  ...props
}: TabsPrimitive.TabsListProps) {
  return (
    <TabsPrimitive.List
      className={cn(
        "grid w-full grid-cols-4 rounded-[1.25rem] border border-[color:var(--border)] bg-[color:var(--surface)] shadow-[var(--shadow-inset)] p-[2px]",
        className
      )}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  style,
  ...props
}: TabsPrimitive.TabsTriggerProps) {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        "inline-flex h-9 w-full items-center justify-center whitespace-nowrap rounded-[1rem] px-2 py-1 text-center text-[12px] leading-none font-normal tracking-[-0.01em] text-[color:var(--muted)] transition data-[state=active]:bg-[color:var(--surface-soft)] data-[state=active]:shadow-[var(--shadow-raised-sm)] data-[state=active]:font-normal data-[state=active]:text-[color:var(--foreground)]",
        className
      )}
      style={{ fontSize: "12px", fontWeight: 400, lineHeight: 1, ...style }}
      {...props}
    />
  );
}

export function TabsContent({
  className,
  ...props
}: TabsPrimitive.TabsContentProps) {
  return (
    <TabsPrimitive.Content
      className={cn("outline-none", className)}
      {...props}
    />
  );
}
