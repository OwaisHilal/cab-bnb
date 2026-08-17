"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
  loading?: boolean;
  loadingLabel?: string;
}

function Spinner({ className }: { className?: string }) {
  return (
    <span
      className={cn(
        "size-4 flex-none animate-spin rounded-full border-2 border-white/30 border-t-white",
        className,
      )}
      aria-hidden="true"
    />
  );
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: "bg-kmr-orange text-white hover:bg-kmr-orange-dark",
  secondary: "bg-kmr-blue text-white hover:bg-kmr-blue-dark",
  ghost: "bg-kmr-surface text-kmr-ink hover:bg-kmr-surface-hover",
};

/**
 * Shared button primitive. Feature components should compose this rather than
 * re-implementing button styles, keeping tap targets and hover states consistent
 * across the mobile-first flows.
 */
export function Button({
  variant = "primary",
  className,
  children,
  loading = false,
  loadingLabel,
  disabled,
  ...rest
}: ButtonProps) {
  return (
    <button
      className={cn(
        "min-h-[50px] w-full rounded-sm px-5 font-archivo text-[15px] font-bold transition-colors",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-kmr-blue",
        "disabled:cursor-not-allowed disabled:opacity-50",
        VARIANT_CLASSES[variant],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading}
      {...rest}
    >
      {loading ? (
        <span className="flex items-center justify-center gap-2">
          <Spinner />
          <span>{loadingLabel ?? "Loading…"}</span>
        </span>
      ) : (
        children
      )}
    </button>
  );
}
