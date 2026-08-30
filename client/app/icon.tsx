import { ImageResponse } from 'next/og'

export const size = { width: 32, height: 32 }
export const contentType = 'image/png'

/** Matches navbar wordmark: slate mark + sky accent. */
export default function Icon() {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: '#0f172a',
          borderRadius: 8,
        }}
      >
        <div
          style={{
            width: 12,
            height: 12,
            borderRadius: 999,
            background: '#38bdf8',
            boxShadow: '0 0 0 3px rgba(56,189,248,0.25)',
          }}
        />
      </div>
    ),
    { ...size }
  )
}
