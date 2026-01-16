// vite.config.ts

import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",

      // чтобы iOS добавлял на экран нормально
      manifest: {
        name: "YosyaDrows",
        short_name: "Yosya",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#060016",
        theme_color: "#060016",
        icons: [
          { src: "/pwa-192.png", sizes: "192x192", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png" },
          { src: "/pwa-512.png", sizes: "512x512", type: "image/png", purpose: "any maskable" },
        ],
      },

      workbox: {
        // кешируем все сборочные файлы + public ассеты
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2,ttf,gif,webp,jpg,jpeg}"],

        // на всякий: чтобы оффлайн не падал на навигации
        navigateFallback: "/index.html",

        runtimeCaching: [
          // black_back.gif и любые public файлы обычно и так попадут в precache,
          // но runtime cache добавляет устойчивость
          {
            urlPattern: ({ request }) => request.destination === "image",
            handler: "CacheFirst",
            options: {
              cacheName: "yosya-images",
              expiration: {
                maxEntries: 300,
                maxAgeSeconds: 60 * 60 * 24 * 365, // 1 год
              },
            },
          },
        ],
      },
    }),
  ],
});
