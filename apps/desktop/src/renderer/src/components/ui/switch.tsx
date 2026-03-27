import * as SwitchPrimitive from "@radix-ui/react-switch";
import { cn } from "@/lib/cn";

export function Switch(props: SwitchPrimitive.SwitchProps) {
  return (
    <SwitchPrimitive.Root
      className={cn(
        "peer inline-flex h-[26px] w-[46px] shrink-0 cursor-pointer items-center rounded-full border border-transparent bg-[color:var(--surface-soft)] shadow-[var(--shadow-inset)] transition data-[state=checked]:bg-[color:var(--accent)] data-[state=checked]:shadow-[inset_0_1px_3px_rgba(0,0,0,0.15)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--ring)] disabled:cursor-not-allowed disabled:opacity-50"
      )}
      {...props}
    >
      <SwitchPrimitive.Thumb
        className={cn(
          "pointer-events-none block h-[22px] w-[22px] translate-x-0.5 rounded-full bg-gradient-to-b from-white to-[#f0f0f0] shadow-[var(--shadow-knob)] ring-0 transition data-[state=checked]:translate-x-[20px]"
        )}
      />
    </SwitchPrimitive.Root>
  );
}
