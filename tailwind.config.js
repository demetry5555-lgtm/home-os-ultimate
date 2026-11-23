/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#0B0F1E',
        surface: '#141B33',
        gold: { DEFAULT: '#E0C184', soft: '#F6E7C1', electric: '#FFDD8F' },
        ivory: '#F7F5EF',
        muted: '#9BA3B4',
      },
      fontFamily: {
        display: ['"Cairo"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 18px 50px rgba(2,6,23,0.55), inset 0 1px 0 rgba(255,255,255,0.12)',
        goldglow: '0 0 28px rgba(255,221,143,0.35)',
      },
    },
  },
  plugins: [],
}
