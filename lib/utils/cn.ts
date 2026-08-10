export type ClassValue = string | number | null | false | undefined;

/**
 * Minimal classnames combiner. Keeps a single, centralized way to compose
 * Tailwind class strings across features without pulling in an extra dependency.
 */
export function cn(...values: ClassValue[]): string {
  return values.filter(Boolean).join(" ");
}
