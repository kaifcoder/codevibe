import { MultiServerMCPClient } from '@langchain/mcp-adapters';

const cleanEnv = (extra: Record<string, string> = {}): Record<string, string> => {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (typeof v === 'string') out[k] = v;
  }
  return { ...out, ...extra };
};

// System-managed MCP servers shared by all users. User-added servers (incl.
// SAP Jira) live per-user in McpServerConfig and are loaded by
// getUserMcpTools() — see mcp-user-store.ts.
const client = new MultiServerMCPClient({
  throwOnLoadError: false,
  prefixToolNameWithServerName: false,
  useStandardContentBlocks: true,
  mcpServers: {
    playwright: {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', '@playwright/mcp@latest'],
      env: cleanEnv({ PLAYWRIGHT_HEADLESS: 'true' }),
    },

    'nextjs-docs-mcp': {
      transport: 'stdio',
      command: 'npx',
      args: ['@taiyokimura/nextjs-docs-mcp@latest'],
    },

    // JSON-only mode — exposes the 7 core tools (search_nodes, get_node,
    // validate_node, validate_workflow, search_templates, get_template,
    // tools_documentation). In-sandbox n8n deploys go through e2b_run_command.
    'n8n-mcp': {
      transport: 'stdio',
      command: 'npx',
      args: ['-y', 'n8n-mcp'],
      env: cleanEnv({
        MCP_MODE: 'stdio',
        LOG_LEVEL: 'error',
        DISABLE_CONSOLE_OUTPUT: 'true',
      }),
    },
  },
});

export async function getMCPTools(...serverNames: string[]) {
  try {
    const tools = await (serverNames.length > 0
      ? client.getTools(...serverNames)
      : client.getTools());
    console.log(`📋 Loaded ${tools.length} MCP tools${serverNames.length ? ` from ${serverNames.join(', ')}` : ''}`);
    return tools;
  } catch (error) {
    console.error('Failed to load MCP tools:', error);
    return [];
  }
}

export async function createPlaywrightMCPTools() {
  return getMCPTools('playwright');
}

export async function createNextJsDocsMCPTools() {
  return getMCPTools('nextjs-docs-mcp');
}

export async function createN8nMCPTools() {
  return getMCPTools('n8n-mcp');
}

export { client as mcpClient };
