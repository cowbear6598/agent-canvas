import { defineConfig, loadEnv, type Plugin, type UserConfig } from "vite";
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

function parseDevBackendPort(rawValue: string | undefined): number {
  const parsed = Number(rawValue ?? "3001");
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535) {
    return parsed;
  }
  return 3001;
}

/**
 * Vite plugin：動態注入 CSP，支援區網 IP 連線
 */
function dynamicCSPPlugin(backendPort: number): Plugin {
  return {
    name: "dynamic-csp",
    transformIndexHtml(html) {
      const localIPs = getLocalIPs();

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
export function createViteConfig(mode: string): UserConfig {
  const env = loadEnv(mode, process.cwd(), "");
  const backendPort = parseDevBackendPort(env.VITE_BACKEND_DEV_PORT);

  return {
    plugins: [vue(), tailwindcss(), dynamicCSPPlugin(backendPort)],
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
                normalizedId.includes("/vue-i18n/") ||
                normalizedId.includes("/@vueuse/")
              ) {
                return "framework";
              }
              if (
                normalizedId.includes("/lucide-vue-next/") ||
                normalizedId.includes("/reka-ui/") ||
                normalizedId.includes("/radix-vue/") ||
                normalizedId.includes("/vue-draggable-plus/")
              ) {
                return "ui-vendor";
              }
              return "vendor";
            }
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
  };
}

export default defineConfig(({ mode }) => createViteConfig(mode));
