/** Wireframe Tailwind config — GREYSCALE ONLY.
 *  The colour palette is replaced (not extended) so no hue can sneak into the wireframes. */
import colors from 'tailwindcss/colors';

/** @type {import('tailwindcss').Config} */
export default {
  content: ['./**/*.html', '!./node_modules/**', '!./screenshots/**'],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      white: '#ffffff',
      black: '#000000',
      gray: colors.neutral,
    },
    extend: {
      fontFamily: {
        mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
      },
    },
  },
  plugins: [],
};
