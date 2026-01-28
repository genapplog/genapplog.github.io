/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./js/**/*.js",
    "./pages/**/*.html"  // <--- ADICIONAMOS ESSA LINHA
  ],
  theme: {
    extend: {},
  },
  plugins: [],
}