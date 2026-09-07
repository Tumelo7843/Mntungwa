/** @type {import('tailwindcss').Config} */
// Visual identity carried over verbatim from the demo (audit §5):
// navy #1a396b primary scale, Inter, and the shadow-card token.
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: {
          DEFAULT: '#1a396b',
          50: '#eef2f9', 100: '#d8e0ef', 200: '#b2c2df',
          300: '#84a0cb', 400: '#4f74ab', 500: '#2c5189',
          600: '#1a396b', 700: '#152f59', 800: '#112546',
          900: '#0c1a32', 950: '#070f1d',
        },
        background: { light: '#f6f7f8', dark: '#13181f' },
      },
      fontFamily: { display: ['Inter', 'system-ui', 'sans-serif'] },
      boxShadow: { card: '0 1px 3px rgba(16,24,40,.08), 0 1px 2px rgba(16,24,40,.04)' },
    },
  },
  plugins: [],
};
