import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiPort = env.PLANEJAMENTO_API_PORT || "8789";

  return {
    plugins: [react()],
    server: {
      host: true,
      port: 5174,
      strictPort: false,
      open: true,
      // Permite acesso via ngrok / túnel público (Vite 6+ bloqueia hosts desconhecidos por padrão)
      allowedHosts: true,
      proxy: {
        "/api": `http://127.0.0.1:${apiPort}`,
      },
    },
  };
});
