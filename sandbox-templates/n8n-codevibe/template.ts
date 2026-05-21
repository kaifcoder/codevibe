import { Template, waitForURL } from 'e2b'

// Provisioning notes:
//  - `fromImage('n8nio/n8n:latest')` and alpine bases fail e2b provisioning.
//    Debian-based `node:22` is the only reliable base.
//  - n8n@latest is installed globally; native deps (better-sqlite3 etc.)
//    compile against debian's already-present build tools.
//  - sqlite3 CLI is installed for build-time verification of the seeded owner.
//  - Owner is created at TEMPLATE BUILD TIME by `seed-owner.sh`, which is
//    copied into the image and executed once. Build FAILS if the user row
//    isn't in SQLite afterward — no silent regressions.
//  - Login: admin@codevibe.com / CodeVibe@2025
//  - Agent uses `n8n` CLI (talks directly to SQLite) — no auth needed.
//  - JWT secret is pinned so sessions survive sandbox restarts.
//  - N8N_PROTOCOL=https + N8N_SECURE_COOKIE=true + SAMESITE=none so the
//    auth cookie is accepted when codevibe iframes the sandbox URL
//    (which is https at the e2b boundary). With Lax/Secure=false the
//    browser silently drops the Set-Cookie header on cross-site requests
//    and login appears to "succeed" but the next request is unauth'd.
export const template = Template()
  .fromImage('node:22')
  .runCmd(
    'apt-get update && apt-get install -y curl sqlite3 && rm -rf /var/lib/apt/lists/*',
    { user: 'root' }
  )
  .runCmd('npm install -g n8n@latest', { user: 'root' })
  .setEnvs({
    N8N_HOST: '0.0.0.0',
    N8N_PORT: '5678',
    N8N_PROTOCOL: 'https',
    N8N_BASIC_AUTH_ACTIVE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_SECURE_COOKIE: 'true',
    N8N_COOKIE_SAMESITE_POLICY: 'none',
    N8N_USER_MANAGEMENT_JWT_SECRET: 'codevibe-jwt-secret-pinned-for-sandbox-32+chars',
    EXECUTIONS_DATA_SAVE_ON_ERROR: 'all',
    EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'all',
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: 'true',
    N8N_ENCRYPTION_KEY: 'codevibe-fixed-encryption-key-change-me'
  })
  .setWorkdir('/home/user')
  .copy('seed-owner.sh', '/usr/local/bin/seed-owner.sh', { user: 'root', mode: 0o755 })
  .runCmd('/usr/local/bin/seed-owner.sh')
  .setStartCmd('n8n start', waitForURL('http://localhost:5678'))
