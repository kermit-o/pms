import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        aubergine: {
          50: '#f6eef3',
          100: '#e9d5e0',
          400: '#9c5a85',
          500: '#7c3f66',
          600: '#5c2a4d',
          700: '#451f3a',
          900: '#2a132a',
        },
      },
      fontFamily: {
        sans: ['ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

export default config;
