import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// Подставляет адрес облака Supabase в политику безопасности (CSP) из index.html.
// Сборка: разрешается ровно наш проект (https для запросов, wss для обновлений в реальном времени).
// Разработка (`npm run dev`): политика убирается, иначе она мешает горячей перезагрузке Vite.
export function cspPlugin(supabaseUrl) {
  let origin = "", ws = "";
  if (supabaseUrl) {
    const url = new URL(supabaseUrl);
    if (!["https:", "http:"].includes(url.protocol)) throw new Error("VITE_SUPABASE_URL должен начинаться с https://");
    origin = url.origin;
    ws = origin.replace(/^http/, "ws");
  }
  return {
    name: "eppaz-csp",
    transformIndexHtml: {
      order: "pre",
      handler(html, ctx) {
        if (ctx.server) return html.replace(/\s*<meta http-equiv="Content-Security-Policy"[^>]*>/, "");
        return html.replaceAll("%CSP_SUPABASE_HTTP%", origin).replaceAll("%CSP_SUPABASE_WS%", ws);
      },
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), "VITE_"), ...process.env };
  return {
    base: "./",
    plugins: [cspPlugin(env.VITE_SUPABASE_URL), react()],
    define: {
      __APP_VERSION__: JSON.stringify(process.env.npm_package_version || "0.3.5"),
      __BUILD_DATE__: JSON.stringify(new Date().toISOString().slice(0, 10)),
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            react: ["react", "react-dom"],
            excel: ["xlsx"],
            supabase: ["@supabase/supabase-js"],
          },
        },
      },
    },
  };
});
