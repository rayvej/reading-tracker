import daisyui from 'daisyui';

/** @type {import('tailwindcss').Config} */
export default {
  content: [
    './docs/index.html',
    './docs/**/*.js'
  ],
  theme: {
    extend: {
      colors: {
        gold:      '#D6A85C',
        goldlight: '#F5D76E',
        accent:    '#38BDF8',
        accent2:   '#818CF8',
        accent3:   '#F472B6',
      }
    }
  },
  plugins: [
    daisyui
  ],
  daisyui: {
    themes: false,
    logs: false
  }
};
