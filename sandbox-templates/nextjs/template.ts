// template.ts
import { Template } from 'e2b'

export const template = Template()
  .fromNodeImage('21-slim')
  .runCmd(
    'apt-get update && apt-get install -y curl && apt-get clean && rm -rf /var/lib/apt/lists/*',
    { user: 'root' }
  )
  .setWorkdir('/home/user/nextjs-app')
  .runCmd('npx --yes create-next-app@15.3.3 . --yes')
  .runCmd('npx --yes shadcn@2.6.3 init --yes -b neutral --force')
  .runCmd('npx --yes shadcn@2.6.3 add --all --yes')
  .runCmd('npm install tw-animate-css clsx tailwind-merge')
  // Guarantee lib/utils.ts exists with the canonical `cn` helper. shadcn
  // init usually creates this, but if it silently fails (path alias mismatch,
  // npx network blip, etc.) the entire shadcn UI breaks at runtime with
  // "Module not found: '@/lib/utils'". Writing it unconditionally makes the
  // build self-healing — if shadcn already wrote it, we just overwrite with
  // identical content.
  .runCmd(
    `mkdir -p lib && cat > lib/utils.ts <<'EOF'
import { type ClassValue, clsx } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
EOF
test -s lib/utils.ts || { echo "lib/utils.ts write failed" >&2; exit 1; }`
  )
  .runCmd('cp -a /home/user/nextjs-app/. /home/user/ && rm -rf /home/user/nextjs-app')
  .setWorkdir('/home/user')
  // Force fast file-system polling so Next/Turbopack picks up `sbx.files.write`
  // edits within ~200ms. Inotify in Firecracker microVMs silently degrades to
  // polling under some kernels, and the default poll interval is ~1s — that's
  // the gap between "agent wrote a file" and "preview shows it". Baked into a
  // project-local .env.local so both `next dev` and the bundler watcher see
  // it without us having to thread it through setStartCmd.
  .runCmd(
    `cat > /home/user/.env.local <<'EOF'
WATCHPACK_POLLING=true
WATCHPACK_POLLING_INTERVAL=200
CHOKIDAR_USEPOLLING=true
CHOKIDAR_INTERVAL=200
EOF`
  )
  // Start the dev server, wait until it accepts traffic, then warm "/" so the
  // first user request doesn't pay Turbopack's cold-compile cost. The warm
  // .next/cache is captured in the snapshot, so every sandbox boots with the
  // landing route already compiled. `node ./node_modules/.bin/next` skips the
  // npx-resolve overhead that `npx next dev` paid on every cold start.
  .setStartCmd(
    'cd /home/user && exec node ./node_modules/.bin/next dev --turbopack -p 3000',
    `bash -c 'until curl -sf -o /dev/null http://localhost:3000; do sleep 0.1; done; curl -sf -o /dev/null http://localhost:3000/ || true'`
  )
