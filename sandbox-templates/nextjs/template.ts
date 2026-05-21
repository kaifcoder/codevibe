// template.ts
import { Template, waitForURL } from 'e2b'

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
  .setStartCmd(
    "bash -c '(while ! curl -sf -o /dev/null http://localhost:3000; do sleep 0.1; done) & cd /home/user && exec npx next dev --turbopack'",
    waitForURL('http://localhost:3000')
  )
