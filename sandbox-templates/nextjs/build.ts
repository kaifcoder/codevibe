import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

async function main() {
  await Template.build(template, 'codevibe-test', {
    memoryMB: 4096,
    cpuCount: 4,
    onBuildLogs: defaultBuildLogger(),
  });
}

main().catch(console.error);