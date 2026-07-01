/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        medical: {
          50: "#eef8ff",
          100: "#d9efff",
          500: "#1689e8",
          600: "#096fc7",
          700: "#075aa2"
        }
      },
      boxShadow: {
        soft: "0 18px 60px rgba(15, 98, 160, 0.12)"
      }
    }
  },
  plugins: []
};
