import type { ReactNode, SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function strokeSvg(size: number, children: ReactNode, props: IconProps) {
  const { size: _s, className, ...rest } = props
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      {...rest}
    >
      {children}
    </svg>
  )
}

export function IconSearch(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </>,
    props
  )
}

export function IconX(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <path d="M18 6 6 18" />
      <path d="m6 6 12 12" />
    </>,
    props
  )
}

export function IconChevronDown(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(s, <path d="m6 9 6 6 6-6" />, props)
}

export function IconChevronUp(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(s, <path d="m18 15-6-6-6 6" />, props)
}

export function IconMessageSquare(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </>,
    props
  )
}

export function IconCheckCircle(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" />
      <path d="m22 4-10 10-3-3" />
    </>,
    props
  )
}

export function IconClock(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 6v6l4 2" />
    </>,
    props
  )
}

export function IconLock(props: IconProps) {
  const s = props.size ?? 14
  return strokeSvg(
    s,
    <>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </>,
    props
  )
}
