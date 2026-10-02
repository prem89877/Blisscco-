/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: { cream: '#FDF8F5', ink: '#2D2A2E', blush: '#FF91A4', rosedeep: '#B3123F' },
      fontFamily: {
        sans: ['Poppins', '"Noto Sans Devanagari"', 'system-ui', 'sans-serif'],
        display: ['"Playfair Display"', '"Noto Serif Devanagari"', 'serif'],
      },
      boxShadow: { card: '0 6px 24px rgba(45,42,46,0.08)' },
    },
  },
  plugins: [],
};
