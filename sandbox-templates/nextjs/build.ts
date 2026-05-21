import { Template, defaultBuildLogger } from 'e2b'
import { template } from './template'

async function main() {
  await Template.build(template, 'codevibe-test', {
    memoryMB: 8192,
    cpuCount: 8,
    onBuildLogs: defaultBuildLogger(),
  });
}

main().catch(console.error);