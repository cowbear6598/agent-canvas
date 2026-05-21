import { defineConfig, type Plugin } from "vite";
import vue from "@vitejs/plugin-vue";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import os from "os";

/**
 * 取得本機區網 IP 位址
 */
function getLocalIPs(): string[] {
  const interfaces = os.networkInterfaces();
  const ips: string[] = [];

  for (const name of Object.keys(interfaces)) {
    const iface = interfaces[name];
    if (!iface) continue;

    for (const addr of iface) {
      // 只取 IPv4 且非內部 IP
      if (addr.family === "IPv4" && !addr.internal) {
        ips.push(addr.address);
      }
    }
  }

  return ips;
}

/**
 * Vite plugin：動態注入 CSP，支援區網 IP 連線
 */
function dynamicCSPPlugin(): Plugin {
  return {
    name: "dynamic-csp",
    transformIndexHtml(html) {
      const localIPs = getLocalIPs();
      const backendPort = 3001;

      // 建立 connect-src 清單
      const connectSources = [
        "'self'",
        `http://localhost:${backendPort}`,
        `ws://localhost:${backendPort}`,
      ];

      // 加入所有區網 IP
      for (const ip of localIPs) {
        connectSources.push(`http://${ip}:${backendPort}`);
        connectSources.push(`ws://${ip}:${backendPort}`);
      }

      const csp = `
        default-src 'self';
        script-src 'self' 'unsafe-inline' 'unsafe-eval';
        style-src 'self' 'unsafe-inline' https://fonts.googleapis.com;
        font-src 'self' https://fonts.gstatic.com data:;
        img-src 'self' data: blob:;
        connect-src ${connectSources.join(" ")};
      `
        .replace(/\s+/g, " ")
        .trim();

      // 注入 CSP meta tag
      return html.replace(
        "<head>",
        `<head>\n    <meta http-equiv="Content-Security-Policy" content="${csp}">`,
      );
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [vue(), tailwindcss(), dynamicCSPPlugin()],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          const normalizedId = id.split(path.sep).join("/");

          if (normalizedId.includes("/node_modules/")) {
            if (
              normalizedId.includes("/marked/") ||
              normalizedId.includes("/dompurify/")
            ) {
              return "markdown";
            }
            if (
              normalizedId.includes("/vue/") ||
              normalizedId.includes("/pinia/") ||
              normalizedId.includes("/vue-i18n/")
            ) {
              return "vendor";
            }
            return "vendor";
          }

          if (normalizedId.includes("/src/")) return "app";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@tests": path.resolve(__dirname, "./tests"),
      "@shared": path.resolve(__dirname, "../shared"),
    },
  },
  server: {
    host: "0.0.0.0",
    headers: {
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "X-XSS-Protection": "1; mode=block",
      "Referrer-Policy": "strict-origin-when-cross-origin",
    },
    // WSL 環境下需要 polling 模式才能正確偵測檔案變化
    watch: {
      usePolling: true,
      interval: 1000,
    },
  },
});
