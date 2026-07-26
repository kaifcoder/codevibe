// template.ts
import { Template } from 'e2b'

export const template = Template()
  .fromNodeImage('24-slim')
  .runCmd(
    'apt-get update && apt-get install -y curl && apt-get clean && rm -rf /var/lib/apt/lists/*',
    { user: 'root' }
  )
  // Scaffold everything in one shot: shadcn init -t vite runs create-vite,
  // wires Tailwind v4, the "@/*" alias, components.json and the cn util.
  // -n names the new project dir; -b radix / -p nova pin the base + preset so
  // init stays non-interactive (latest CLI otherwise prompts for both).
  .setWorkdir('/home/user')
  .runCmd('npx --yes shadcn@latest init -t vite -n vite-app -b radix -p nova --yes --force')
  .setWorkdir('/home/user/vite-app')
  // Add the full component library.
  .runCmd('npx --yes shadcn@latest add --all --yes')
  // Re-write vite.config.ts with the E2B dev-server block: bind 0.0.0.0:3000,
  // accept the dynamic *.e2b.app host, route HMR through the https proxy, and
  // poll the filesystem so sbx.files.write edits are picked up inside the
  // Firecracker microVM.
  .runCmd(
    `cat > vite.config.ts <<'EOF'
import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    allowedHosts: true,
    hmr: { clientPort: 443, protocol: "wss" },
    watch: { usePolling: true, interval: 200 },
  },
})
EOF`
  )
  .runCmd('cp -a /home/user/vite-app/. /home/user/ && rm -rf /home/user/vite-app')
  .setWorkdir('/home/user')
  // Start the Vite dev server and wait until it accepts traffic so the warm
  // snapshot boots with the app already compiled.
  .setStartCmd(
    'exec node ./node_modules/.bin/vite --host 0.0.0.0 --port 3000',
    `bash -c 'until curl -sf -o /dev/null http://localhost:3000; do sleep 0.1; done'`
  )
