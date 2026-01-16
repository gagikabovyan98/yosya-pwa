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
