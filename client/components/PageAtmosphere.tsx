/** Soft radial + grid wash behind page titles. Light and dark aware. */
export default function PageAtmosphere({ tall = false }: { tall?: boolean }) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute inset-x-0 -top-4 overflow-hidden ${
        tall ? 'h-56' : 'h-52'
      }`}
    >
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(15,23,42,0.06),_transparent_65%)] dark:bg-[radial-gradient(ellipse_at_top,_rgba(148,163,184,0.1),_transparent_65%)]" />
      <div
        className="absolute inset-0 opacity-[0.35] dark:opacity-[0.12]"
        style={{
          backgroundImage:
            'linear-gradient(to right, rgb(100 116 139 / 0.22) 1px, transparent 1px), linear-gradient(to bottom, rgb(100 116 139 / 0.22) 1px, transparent 1px)',
          backgroundSize: '28px 28px',
          maskImage: 'linear-gradient(to bottom, black, transparent)',
        }}
      />
    </div>
  )
}
