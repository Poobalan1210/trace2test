/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    // A 4 px grid: Tailwind's default spacing scale is already 0.25rem steps.
    extend: {
      colors: {
        bg: '#090C12',
        panel: '#10151F',
        raised: '#182030',
        line: '#222B3A',
        ink: '#EDF0F5',
        // Body copy: softer than ink for long text, brighter than muted.
        body: '#B6BECC',
        muted: '#8790A1',
        amber: { DEFAULT: '#F5A524', soft: 'rgba(245,165,36,0.12)' },
        danger: { DEFAULT: '#F0524F', soft: 'rgba(240,82,79,0.12)' },
        ok: { DEFAULT: '#3DD68C', soft: 'rgba(61,214,140,0.12)' },
        // Lantern Books, the demo storefront, has its own light palette.
        paper: '#FBF8F3',
        bookink: '#1F1A14',
        bookmuted: '#6B6258',
        bookaccent: '#8A4B14',
        bookerr: '#B42318',
      },
      fontFamily: {
        sans: ['"IBM Plex Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
        serif: ['Georgia', '"Times New Roman"', 'serif'],
      },
      fontSize: { base: ['15px', '23px'] },
      borderRadius: { panel: '12px' },
      boxShadow: {
        panel: 'inset 0 1px 0 rgba(255,255,255,0.035), 0 1px 2px rgba(0,0,0,0.35), 0 8px 24px -12px rgba(0,0,0,0.5)',
        glow: '0 0 0 1px rgba(245,165,36,0.35), 0 8px 28px -8px rgba(245,165,36,0.35)',
      },
      keyframes: {
        slidein: { from: { opacity: '0', transform: 'translateY(-6px)' }, to: { opacity: '1', transform: 'none' } },
        pulsedot: { '0%,100%': { opacity: '1' }, '50%': { opacity: '0.35' } },
        shimmer: { '0%,100%': { opacity: '0.55' }, '50%': { opacity: '0.9' } },
      },
      animation: {
        slidein: 'slidein 180ms ease-out',
        pulsedot: 'pulsedot 1.2s ease-in-out infinite',
        shimmer: 'shimmer 1.6s ease-in-out infinite',
      },
    },
  },
  plugins: [],
};
