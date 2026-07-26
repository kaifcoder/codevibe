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
  // Bake a cool animated welcome screen as the default App.tsx so a fresh
  // sandbox boots with something alive instead of the create-vite boilerplate.
  // Uses Tailwind + tw-animate-css entrance classes only (no custom keyframes).
  .runCmd(
    `cat > src/App.tsx <<'EOF'
import { Sparkles } from "lucide-react"

function App() {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center overflow-hidden bg-background px-6 text-center text-foreground">
      {/* animated gradient blobs */}
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute -left-24 -top-24 h-96 w-96 animate-pulse rounded-full bg-primary/30 blur-3xl" />
        <div className="absolute -right-24 top-1/3 h-96 w-96 animate-pulse rounded-full bg-fuchsia-500/20 blur-3xl [animation-delay:1s]" />
        <div className="absolute bottom-0 left-1/3 h-96 w-96 animate-pulse rounded-full bg-cyan-500/20 blur-3xl [animation-delay:2s]" />
      </div>

      <div className="flex flex-col items-center gap-6">
        <span className="inline-flex animate-in items-center gap-2 rounded-full border border-border bg-card/50 px-4 py-1.5 text-sm text-muted-foreground backdrop-blur duration-700 fade-in zoom-in">
          <Sparkles className="h-4 w-4 text-primary" />
          Powered by CodeVibe
        </span>

        <h1 className="animate-in bg-linear-to-r from-primary via-fuchsia-500 to-cyan-500 bg-clip-text text-6xl font-black tracking-tight text-transparent duration-700 fade-in slide-in-from-bottom-4 [animation-delay:150ms] sm:text-8xl">
          Start Vibing
        </h1>

        <p className="max-w-md animate-in text-lg text-muted-foreground duration-700 fade-in slide-in-from-bottom-4 [animation-delay:300ms]">
          Describe what you want to build and watch it come alive. Your canvas is ready.
        </p>

        <div className="flex animate-in items-center gap-2 text-sm text-muted-foreground duration-700 fade-in slide-in-from-bottom-4 [animation-delay:450ms]">
          <span className="relative flex h-2.5 w-2.5">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
          </span>
          Live preview connected
        </div>
      </div>
    </main>
  )
}

export default App
EOF`
  )
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
