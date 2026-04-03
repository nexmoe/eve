import * as SelectPrimitive from "@radix-ui/react-select";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/cn";

export const Select = SelectPrimitive.Root;
export const SelectValue = SelectPrimitive.Value;

export function SelectTrigger({
  className,
  ...props
}: SelectPrimitive.SelectTriggerProps) {
  return (
    <SelectPrimitive.Trigger
      className={cn(
        "flex min-h-9 w-full min-w-0 max-w-full items-start justify-between gap-2 rounded-lg border border-[color:var(--border)] bg-[color:var(--surface)] px-3 py-2 text-left text-xs text-[color:var(--foreground)] shadow-[var(--shadow-inset)] outline-none transition focus:border-[color:var(--ring)] focus:ring-1 focus:ring-[color:var(--ring)] data-[placeholder]:text-[color:var(--muted)]",
        className
      )}
      {...props}
    >
      <SelectPrimitive.Value className="block min-w-0 flex-1 break-words pr-1 leading-6 whitespace-normal" />
      <SelectPrimitive.Icon asChild>
        <ChevronDown className="mt-1 h-3.5 w-3.5 shrink-0 text-[color:var(--muted)]" />
      </SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  );
}

export function SelectContent({
  className,
  children,
  position = "popper",
  ...props
}: SelectPrimitive.SelectContentProps) {
  return (
    <SelectPrimitive.Portal>
      <SelectPrimitive.Content
        className={cn(
          "relative z-50 max-h-72 min-w-[8rem] overflow-hidden rounded-lg border border-[color:var(--border)] bg-white text-[color:var(--foreground)] shadow-[0_4px_16px_rgba(0,0,0,0.12),var(--shadow-raised)] dark:bg-[#1f1f22]",
          position === "popper" &&
            "data-[side=bottom]:translate-y-1 data-[side=left]:-translate-x-1 data-[side=right]:translate-x-1 data-[side=top]:-translate-y-1",
          className
        )}
        position={position}
        {...props}
      >
        <SelectPrimitive.Viewport className="p-1">
          {children}
        </SelectPrimitive.Viewport>
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  );
}

export function SelectItem({
  className,
  children,
  ...props
}: SelectPrimitive.SelectItemProps) {
  return (
    <SelectPrimitive.Item
      className={cn(
        "relative flex w-full cursor-default select-none items-start rounded-md py-1.5 pl-8 pr-2 text-xs outline-none transition focus:bg-[color:var(--surface-soft)] focus:text-[color:var(--foreground)] data-[disabled]:pointer-events-none data-[disabled]:opacity-50",
        className
      )}
      {...props}
    >
      <span className="absolute left-2 flex h-3.5 w-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator>
          <Check className="h-3.5 w-3.5" />
        </SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemText className="break-words leading-5 whitespace-normal">
        {children}
      </SelectPrimitive.ItemText>
    </SelectPrimitive.Item>
  );
}
