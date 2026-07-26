// template.ts
import { Template } from 'e2b'

export const template = Template()
  .fromNodeImage('24-slim')
  .runCmd(
    'apt-get update && apt-get install -y curl && apt-get clean && rm -rf /var/lib/apt/lists/*',
    { user: 'root' }
  )
  .setWorkdir('/home/user/vite-app')
  // Scaffold a Vite + React + TypeScript app in the current directory. The
  // `--template react-ts` flag makes create-vite fully non-interactive.
  .runCmd('npm create vite@latest . -- --template react-ts')
  .runCmd('npm install')
  // Tailwind v4 via the official Vite plugin (no PostCSS config needed) plus
  // the shadcn runtime helpers.
  .runCmd('npm install tailwindcss @tailwindcss/vite')
  .runCmd('npm install -D @types/node')
  .runCmd('npm install clsx tailwind-merge class-variance-authority lucide-react tw-animate-css')
  // Tailwind entrypoint. shadcn init (below) appends its theme variables to
  // this file; it only needs the `@import "tailwindcss";` line to be present.
  .runCmd(
    `cat > src/index.css <<'EOF'
@import "tailwindcss";
@import "tw-animate-css";
EOF`
  )
  // Vite config: React + Tailwind plugins, the "@" -> "./src" path alias that
  // shadcn and the agent rely on, dev server bound to 0.0.0.0:3000, and HMR
  // wired for the E2B https proxy. Force-polling so `sbx.files.write` edits are
  // picked up within ~200ms inside the Firecracker microVM.
  .runCmd(
    `cat > vite.config.ts <<'EOF'
import path from "path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
  },
  server: {
    host: true,
    port: 3000,
    strictPort: true,
    // The E2B proxy serves the sandbox from a dynamic *.e2b.app host — allow
    // any host so Vite doesn't reject the proxied request.
    allowedHosts: true,
    // HMR travels back through the https proxy on 443 as a secure websocket.
    hmr: { clientPort: 443, protocol: "wss" },
    watch: { usePolling: true, interval: 200 },
  },
})
EOF`
  )
  // Add the "@/*" -> "./src/*" path mapping to BOTH tsconfig files so shadcn's
  // codegen and the TS language server resolve the alias.
  .runCmd(
    `cat > tsconfig.json <<'EOF'
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ],
  "compilerOptions": {
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  }
}
EOF`
  )
  .runCmd(
    `cat > tsconfig.app.json <<'EOF'
{
  "compilerOptions": {
    "tsBuildInfoFile": "./node_modules/.tmp/tsconfig.app.tsbuildinfo",
    "target": "ES2022",
    "useDefineForClassFields": true,
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "skipLibCheck": true,
    "moduleResolution": "bundler",
    "allowImportingTsExtensions": true,
    "verbatimModuleSyntax": true,
    "moduleDetection": "force",
    "noEmit": true,
    "jsx": "react-jsx",
    "strict": true,
    "noUnusedLocals": false,
    "noUnusedParameters": false,
    "noFallthroughCasesInSwitch": true,
    "noUncheckedSideEffectImports": true,
    "baseUrl": ".",
    "paths": {
      "@/*": ["./src/*"]
    }
  },
  "include": ["src"]
}
EOF`
  )
  // Initialise shadcn (neutral base color) and pull in the full component
  // library. init detects the Vite project, writes components.json, injects
  // the theme variables into src/index.css, and creates src/lib/utils.ts.
  .runCmd('npx --yes shadcn@2.6.3 init --yes -b neutral --force')
  .runCmd('npx --yes shadcn@2.6.3 add --all --yes')
  // Guarantee lib/utils.ts exists with the canonical `cn` helper. shadcn init
  // usually creates this, but if it silently fails (path alias mismatch, npx
  // network blip, etc.) the entire shadcn UI breaks at runtime with
  // "Module not found: '@/lib/utils'". Writing it unconditionally makes the
  // build self-healing — if shadcn already wrote it, we overwrite with
  // identical content.
  .runCmd(
    `mkdir -p src/lib && cat > src/lib/utils.ts <<'EOF'
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
EOF
test -s src/lib/utils.ts || { echo "src/lib/utils.ts write failed" >&2; exit 1; }`
  )
  .runCmd('cp -a /home/user/vite-app/. /home/user/ && rm -rf /home/user/vite-app')
  .setWorkdir('/home/user')
  // Start the Vite dev server, wait until it accepts traffic, then warm "/" so
  // the first user request doesn't pay the cold dependency-optimize cost. The
  // warm state is captured in the snapshot, so every sandbox boots with the
  // landing route already compiled.
  .setStartCmd(
    'cd /home/user && exec node ./node_modules/.bin/vite --host 0.0.0.0 --port 3000',
    `bash -c 'until curl -sf -o /dev/null http://localhost:3000; do sleep 0.1; done; curl -sf -o /dev/null http://localhost:3000/ || true'`
  )
