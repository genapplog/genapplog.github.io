/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./js/**/*.js",
    "./public/pages/**/*.html"  // ✅ ESSA É A LINHA QUE SALVA O LAYOUT
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}