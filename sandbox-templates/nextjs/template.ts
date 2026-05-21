// template.ts
import { Template, waitForURL } from 'e2b'

export const template = Template()
  .fromBunImage('1.3')
  .setWorkdir('/home/user/nextjs-app')
  // Pinned to Next 15: Next 16 + Turbopack-as-default eats enough RAM in a
  // ~1GB e2b sandbox to starve the e2b daemon, which makes
  // /api/sync-filesystem time out and HMR crawl. Production deploys still
  // ship next@16.2.6 — bumpVulnerableDeps() in
  // src/app/api/deploy-to-vercel/route.ts rewrites package.json on the way
  // out, so the sandbox doesn't need to be on 16 to dodge Vercel's
  // vulnerability warning.
  //
  // Next 15 still accepts the `--turbopack` flag, which is the source of the
  // fast HMR users expect. Don't drop it.
  .runCmd(
    'bun create next-app@15 --app --ts --tailwind --turbopack --yes --use-bun .'
  )
  // shadcn 4.6 split config into "presets" (Nova/Vega/Maia/...). `--yes` no
  // longer skips that picker — you have to pass `--preset` explicitly or the
  // CLI hangs on the arrow-key prompt during the e2b build. Nova = Lucide
  // icons + Geist font, which matches the agent prompt's assumption that
  // `lucide-react` is pre-installed. `-b base` sets the base color (4.x
  // dropped the old neutral/zinc/stone presets, keeping only `base` and
  // `radix`). If you regenerate codevibe's src/components/ui snapshot for
  // the deploy fallback, use the same `--preset nova -b base` so the
  // snapshot matches what fresh sandboxes produce.
  .runCmd('bunx --bun shadcn@4.6.0 init --yes --force --preset nova -b base')
  .runCmd('bunx --bun shadcn@4.6.0 add --all --yes')
  .runCmd(
    'cp -a /home/user/nextjs-app/. /home/user/ && rm -rf /home/user/nextjs-app'
  )
  .setWorkdir('/home/user')
  .setStartCmd('bun --bun run dev', waitForURL('http://localhost:3000'))
