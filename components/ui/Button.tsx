"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils/cn";

type ButtonVariant = "primary" | "secondary" | "ghost";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: ReactNode;
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
      {...rest}
    >
      {children}
    </button>
  );
}
