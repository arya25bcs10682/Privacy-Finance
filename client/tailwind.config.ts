import type { Config } from "tailwindcss";
import tailwindcssAnimate from "tailwindcss-animate";

const config: Config = {
  darkMode: ["class"],
  content: ["./index.html", "./src/**/*.{ts,tsx,js,jsx}"],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      colors: {
        // Core Project Rules Color Tokens
        background: "#000000",
        foreground: "#E0E3E6",
        card: {
          DEFAULT: "#0C0E10",
          foreground: "#E0E3E6",
        },
        sidebar: {
          DEFAULT: "#0C0E10",
          foreground: "#E0E3E6",
          border: "#1F242D",
        },
        border: "#1F242D",
        gridline: "#161B22",
        nav: {
          DEFAULT: "#0C0E10",
          active: "#2A2D32",
        },
        trend: {
          green: "#22C55E",
          red: "#EF4444",
        },
        // shadcn/ui compatible semantic tokens
        popover: {
          DEFAULT: "#0C0E10",
          foreground: "#E0E3E6",
        },
        primary: {
          DEFAULT: "#E0E3E6",
          foreground: "#000000",
        },
        secondary: {
          DEFAULT: "#2A2D32",
          foreground: "#E0E3E6",
        },
        muted: {
          DEFAULT: "#161B22",
          foreground: "#8B949E",
        },
        accent: {
          DEFAULT: "#2A2D32",
          foreground: "#E0E3E6",
        },
        destructive: {
          DEFAULT: "#EF4444",
          foreground: "#FFFFFF",
        },
        input: "#1F242D",
        ring: "#2A2D32",
      },
      borderRadius: {
        lg: "0.5rem",
        md: "calc(0.5rem - 2px)",
        sm: "calc(0.5rem - 4px)",
      },
    },
  },
  plugins: [tailwindcssAnimate],
};

export default config;
