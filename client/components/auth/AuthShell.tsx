'use client'

import type { ReactNode } from 'react'
import Link from 'next/link'

export type AuthShellProps = {
  /** Eyebrow above the brand headline (desktop panel) */
  eyebrow?: string
  headline: string
  description: string
  bullets?: string[]
  /** Short line under the mobile ClockInn mark */
  mobileSubtitle?: string
  /** Form card title */
  formTitle: string
  /** Form card support line */
  formDescription?: ReactNode
  footer?: ReactNode
  children: ReactNode
}

export function AuthShell({
  eyebrow = 'ClockInn Pro',
  headline,
  description,
  bullets = [],
  mobileSubtitle,
  formTitle,
  formDescription,
  footer,
  children,
}: AuthShellProps) {
  return (
    <div className="flex min-h-screen bg-page text-foreground">
      {/* Brand panel */}
      <div className="relative hidden overflow-hidden bg-slate-900 text-white lg:flex lg:w-[48%] xl:w-1/2">
        <div
          aria-hidden={true}
          className="absolute inset-0 opacity-40"
          style={{
            backgroundImage:
              'radial-gradient(circle at 12% 20%, rgba(45,212,191,0.28), transparent 42%), radial-gradient(circle at 88% 10%, rgba(59,130,246,0.22), transparent 36%)',
          }}
        />
        <div
          aria-hidden={true}
          className="absolute inset-y-0 right-0 w-1/2 opacity-[0.07]"
          style={{
            backgroundImage:
              'repeating-linear-gradient(-32deg, transparent, transparent 10px, white 10px, white 11px)',
          }}
        />
        <div
          aria-hidden={true}
          className="pointer-events-none absolute inset-0 opacity-[0.12]"
          style={{
            backgroundImage:
              'linear-gradient(to right, rgb(148 163 184 / 0.35) 1px, transparent 1px), linear-gradient(to bottom, rgb(148 163 184 / 0.35) 1px, transparent 1px)',
            backgroundSize: '28px 28px',
            maskImage: 'linear-gradient(to bottom, black 40%, transparent)',
          }}
        />

        <div className="relative z-10 flex w-full flex-col justify-between px-12 py-12 xl:px-16 xl:py-14">
          <Link
            href="/login"
            className="inline-flex shrink-0 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-sky-400/60 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-900"
          >
            <span className="flex flex-col leading-none">
              <span className="text-[15px] font-semibold tracking-tight text-white">
                ClockInn
                <span className="font-medium text-slate-400"> Pro</span>
              </span>
              <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-slate-500">
                Time & attendance
              </span>
            </span>
          </Link>

          <div className="max-w-md py-16">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-slate-400">
              {eyebrow}
            </p>
            <h1 className="mt-3 text-balance text-4xl font-semibold tracking-tight text-white xl:text-[2.75rem] xl:leading-[1.15]">
              {headline}
            </h1>
            <p className="mt-4 text-base leading-relaxed text-slate-300">{description}</p>
            {bullets.length > 0 && (
              <ul className="mt-10 space-y-3.5">
                {bullets.map((item) => (
                  <li key={item} className="flex gap-3 text-sm text-slate-300">
                    <span
                      className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-teal-300/90"
                      aria-hidden
                    />
                    <span className="leading-relaxed">{item}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <p className="text-xs text-slate-500">Built for hotels and multi-site operations</p>
        </div>
      </div>

      {/* Form column */}
      <div className="flex w-full flex-1 items-center justify-center px-4 py-12 sm:px-6 lg:px-10 xl:px-14">
        <div className="w-full max-w-md">
          <div className="mb-8 text-center lg:hidden">
            <Link
              href="/login"
              className="inline-flex items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-2 focus-visible:ring-offset-page"
            >
              <span className="flex flex-col items-center leading-none">
                <span className="text-[15px] font-semibold tracking-tight text-foreground">
                  ClockInn
                  <span className="font-medium text-foreground-muted"> Pro</span>
                </span>
                <span className="mt-0.5 text-[10px] font-medium uppercase tracking-[0.14em] text-foreground-subtle">
                  Time & attendance
                </span>
              </span>
            </Link>
            {mobileSubtitle && (
              <p className="mt-3 text-sm text-foreground-muted">{mobileSubtitle}</p>
            )}
          </div>

          <div className="rounded-2xl border border-border bg-surface p-7 shadow-subtle sm:p-9">
            <div className="mb-7">
              <h2 className="text-xl font-semibold tracking-tight text-foreground">{formTitle}</h2>
              {formDescription && (
                <p className="mt-1.5 text-sm leading-relaxed text-foreground-muted">
                  {formDescription}
                </p>
              )}
            </div>
            {children}
          </div>

          {footer && <div className="mt-8 text-center text-xs text-foreground-subtle">{footer}</div>}
        </div>
      </div>
    </div>
  )
}

export const authInputClass =
  'block w-full rounded-xl border border-border bg-surface px-3.5 py-2.5 text-sm text-foreground shadow-sm placeholder:text-foreground-subtle transition focus:border-transparent focus:outline-none focus:ring-2 focus:ring-accent disabled:cursor-not-allowed disabled:opacity-60'

export const authLabelClass = 'mb-1.5 block text-sm font-medium text-foreground-muted'

export function AuthFieldError({ message }: { message?: string }) {
  if (!message) return null
  return (
    <p className="mt-1.5 flex items-start gap-1.5 text-sm text-danger">
      <svg className="mt-0.5 h-4 w-4 shrink-0" fill="currentColor" viewBox="0 0 20 20" aria-hidden>
        <path
          fillRule="evenodd"
          d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7 4a1 1 0 11-2 0 1 1 0 012 0zm-1-9a1 1 0 00-1 1v4a1 1 0 102 0V6a1 1 0 00-1-1z"
          clipRule="evenodd"
        />
      </svg>
      <span>{message}</span>
    </p>
  )
}
