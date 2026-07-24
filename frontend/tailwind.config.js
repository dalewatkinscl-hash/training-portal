/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx,ts,tsx}'],
  theme: {
    extend: {
      colors: {
        cl: {
          deep: 'var(--cl-bg-deep)',
          base: 'var(--cl-bg-base)',
          elevated: 'var(--cl-bg-elevated)',
          surface: 'var(--cl-surface)',
          'surface-hover': 'var(--cl-surface-hover)',
          fg: 'var(--cl-foreground)',
          muted: 'var(--cl-foreground-muted)',
          accent: 'var(--cl-accent)',
          'accent-bright': 'var(--cl-accent-bright)',
          border: 'var(--cl-border)',
          'border-hover': 'var(--cl-border-hover)',
          input: 'var(--cl-input-bg)',
        },
      },
      fontFamily: {
        sans: ['Inter', 'Geist Sans', 'system-ui', 'sans-serif'],
      },
      transitionTimingFunction: {
        'cl-out': 'cubic-bezier(0.16, 1, 0.3, 1)',
      },
      animation: {
        'fade-in': 'fadeIn 0.25s cubic-bezier(0.16, 1, 0.3, 1)',
        'cl-float': 'cl-float 9s ease-in-out infinite',
        'cl-float-delayed': 'cl-float 11s ease-in-out infinite 1.5s',
      },
      keyframes: {
        fadeIn: {
          from: { opacity: '0', transform: 'translateY(8px)' },
          to: { opacity: '1', transform: 'translateY(0)' },
        },
        'cl-float': {
          '0%, 100%': { transform: 'translateY(0) rotate(0deg)' },
          '50%': { transform: 'translateY(-20px) rotate(1deg)' },
        },
      },
      boxShadow: {
        'cl-card': 'var(--cl-shadow-card)',
        'cl-card-hover': 'var(--cl-shadow-card-hover)',
        'cl-accent': 'var(--cl-shadow-accent)',
      },
    },
  },
  plugins: [],
};
