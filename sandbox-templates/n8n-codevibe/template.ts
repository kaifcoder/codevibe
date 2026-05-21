import { Template, waitForURL } from 'e2b'

// Provisioning notes (from earlier failed builds):
//  - `fromImage('n8nio/n8n:latest')` fails at "Provisioning sandbox template"
//    even after clearing the tini ENTRYPOINT. The upstream image's rootfs
//    layout breaks e2b's agent injection.
//  - `fromImage('node:20-alpine')` also fails at provisioning — alpine
//    doesn't ship bash, and e2b's provisioner appears to require it.
//  - Debian-based `node:20` provisions cleanly. ~350 MB heavier than alpine
//    but predictable, and the agent only spins up one sandbox at a time.
//
// Layered config:
//   - `npm i -g n8n` installs the CLI; native deps (sqlite3, etc.) compile
//     against debian's already-present build tools.
//   - Env vars disable auth/diagnostics for sandbox use and force the server
//     to bind 0.0.0.0 so the e2b proxy can route :5678 traffic.
//   - N8N_SECURE_COOKIE=false because the e2b-exposed URL is HTTP at the
//     sandbox boundary; without this n8n refuses to set its session cookie.
export const template = Template()
  .fromImage('node:22')
  .runCmd('npm install -g n8n@latest', { user: 'root' })
  .copy('n8n-seed', '/home/user/.n8n', { user: 'user' })
  .setEnvs({
    N8N_HOST: '0.0.0.0',
    N8N_PORT: '5678',
    N8N_PROTOCOL: 'http',
    N8N_BASIC_AUTH_ACTIVE: 'false',
    N8N_DIAGNOSTICS_ENABLED: 'false',
    N8N_PERSONALIZATION_ENABLED: 'false',
    N8N_SECURE_COOKIE: 'false',
    EXECUTIONS_DATA_SAVE_ON_ERROR: 'all',
    EXECUTIONS_DATA_SAVE_ON_SUCCESS: 'all',
    EXECUTIONS_DATA_SAVE_MANUAL_EXECUTIONS: 'true',
    N8N_ENCRYPTION_KEY: 'codevibe-fixed-key-change-me'
  })
  .setWorkdir('/home/user')
  .setStartCmd('n8n start', waitForURL('http://localhost:5678'))
