interface IconProps {
  className?: string
  size?: number
}

const baseProps = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  className,
  "aria-hidden": true as const,
})

const STROKE = { stroke: "currentColor", strokeWidth: 1.9, strokeLinecap: "round" as const, strokeLinejoin: "round" as const }

export const CalendarIcon = ({ className, size = 14 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <rect x="4" y="5.5" width="16" height="14.5" rx="2.5" {...STROKE} />
    <path d="M4 10h16M8.5 3.5v4M15.5 3.5v4" {...STROKE} />
  </svg>
)

export const UsersIcon = ({ className, size = 14 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="9" cy="8.5" r="3.2" {...STROKE} />
    <path d="M3.5 19c.8-3 3-4.5 5.5-4.5s4.7 1.5 5.5 4.5" {...STROKE} />
    <path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.7c1.7.5 2.7 1.9 3 4.3" {...STROKE} />
  </svg>
)

export const CarIcon = ({ className, size = 14 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M4 16v-3l2-5h12l2 5v3h-2.5m-11 0H4m2.5 0a1.5 1.5 0 1 0 3 0m5 0a1.5 1.5 0 1 0 3 0m-8 0h5" {...STROKE} />
  </svg>
)

export const LockIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <rect x="5" y="10.5" width="14" height="9.5" rx="2.5" {...STROKE} />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" {...STROKE} />
  </svg>
)

export const ShieldCheckIcon = ({ className, size = 14 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 3.5 5 6v5.5c0 4.2 2.8 7.4 7 9 4.2-1.6 7-4.8 7-9V6l-7-2.5Z" {...STROKE} />
    <path d="m9 12 2.2 2.2L15.2 10" {...STROKE} />
  </svg>
)

export const CheckIcon = ({ className, size = 22 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
  </svg>
)

export const ClockIcon = ({ className, size = 22 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="8.5" {...STROKE} />
    <path d="M12 7.5V12l3 2" {...STROKE} />
  </svg>
)

export const InfoIcon = ({ className, size = 22 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="12" cy="12" r="8.5" {...STROKE} />
    <path d="M12 11v5.2M12 7.8v.1" {...STROKE} />
  </svg>
)

export const PhoneIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path
      d="M6.5 4h3l1.4 3.6-1.9 1.3a10 10 0 0 0 4.1 4.1l1.3-1.9L18 12.5v3a2 2 0 0 1-2.2 2A12.5 12.5 0 0 1 4.5 6.2 2 2 0 0 1 6.5 4Z"
      {...STROKE}
    />
  </svg>
)

export const WhatsAppGlyphIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 4a8 8 0 0 0-6.9 12L4 20l4.1-1A8 8 0 1 0 12 4Z" {...STROKE} />
    <path d="M9 9.5c.4 2.2 3 4.7 5.2 5.1l1.3-1.5-1.9-1-1 .5c-.8-.5-1.5-1.2-1.9-2l.5-1-1-1.9L9 9.5Z" fill="currentColor" />
  </svg>
)

export const UsersGroupIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <circle cx="8.5" cy="9" r="2.8" {...STROKE} />
    <circle cx="16" cy="9.5" r="2.4" {...STROKE} />
    <path d="M3.5 18.5c.7-2.7 2.7-4 5-4s4.3 1.3 5 4M14.5 14.8c2.4-.3 4.5.8 5.3 3.4" {...STROKE} />
  </svg>
)

export const StarIcon = ({ className, size = 11 }: IconProps) => (
  <svg width={size} height={size} viewBox="0 0 24 24" className={className} aria-hidden="true">
    <path
      d="m12 3.6 2.6 5.4 5.9.8-4.3 4.1 1.1 5.9-5.3-2.8-5.3 2.8 1.1-5.9-4.3-4.1 5.9-.8L12 3.6Z"
      fill="currentColor"
    />
  </svg>
)

export const ChevronRightIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="m9.5 5.5 6.5 6.5-6.5 6.5" {...STROKE} />
  </svg>
)

export const AlertIcon = ({ className, size = 16 }: IconProps) => (
  <svg {...baseProps(size, className)}>
    <path d="M12 4 3.5 19h17L12 4Z" {...STROKE} />
    <path d="M12 10v4M12 16.6v.1" {...STROKE} />
  </svg>
)
