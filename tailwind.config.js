/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        obsidian: '#08090D',
        surface: '#12141B',
        gold: { DEFAULT: '#D6B56D', soft: '#F1DDAA', electric: '#FFD36A' },
        ivory: '#F8F6F0',
        muted: '#A8A8AD',
      },
      fontFamily: {
        display: ['"Cairo"', 'system-ui', 'sans-serif'],
      },
      boxShadow: {
        glass: '0 8px 32px rgba(0,0,0,0.45), inset 0 1px 0 rgba(241,221,170,0.08)',
        goldglow: '0 0 24px rgba(255,211,106,0.35)',
      },
    },
  },
  plugins: [],
}
