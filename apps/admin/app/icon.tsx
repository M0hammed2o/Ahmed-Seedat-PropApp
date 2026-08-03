import { ImageResponse } from 'next/og';

// Static Next.js App Router convention -- this file alone makes Next.js generate and serve
// /icon (used as the browser-tab favicon) with zero routing/manifest wiring needed. No favicon
// asset has ever existed anywhere in this app before (confirmed: no public/, no app/favicon.ico) --
// this is what the "pre-existing benign favicon 404" noted across this session's browser-verification
// passes actually was. Colour matches packages/ui/src/tokens.ts light.accent (#106ADD), the same
// brand accent used for the icon badge on /login and /register.
export const size = { width: 32, height: 32 };
export const contentType = 'image/png';

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
          background: '#106ADD',
          borderRadius: 7,
          color: '#FFFFFF',
          fontSize: 20,
          fontWeight: 700,
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        P
      </div>
    ),
    { ...size },
  );
}
