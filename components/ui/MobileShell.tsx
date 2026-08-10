import type { ReactNode } from "react";

interface MobileShellProps {
  children: ReactNode;
}

/**
 * Constrains every screen to the mobile-first app shell (max-width 430px),
 * matching the reference prototype. Wider viewports get a centered shell with
 * a neutral backdrop instead of a desktop-specific layout.
 */
export function MobileShell({ children }: MobileShellProps) {
  return (
    <div className="flex min-h-dvh w-full justify-center bg-kmr-backdrop">
      <div className="relative flex h-dvh w-full max-w-[430px] flex-col overflow-hidden bg-white shadow-[0_0_40px_rgba(16,17,24,0.12)]">
        {children}
      </div>
    </div>
  );
}
