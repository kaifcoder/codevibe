import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpTools } from '@langchain/mcp-adapters';

// MCP Server configuration
interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Cache for MCP clients and their health status
const mcpClients = new Map<string, { client: Client; healthy: boolean }>();

/**
 * Initialize an MCP client for a specific server with error handling
 */
async function initMCPClient(serverName: string, config: MCPServerConfig): Promise<Client> {
  const client = new Client({
    name: 'codevibe-mcp-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });

  // Handle transport errors to prevent EPIPE crashes
  transport.onerror = (error) => {
    console.error(`[MCP] Transport error for ${serverName}:`, error.message);
    const entry = mcpClients.get(serverName);
    if (entry) {
      entry.healthy = false;
    }
  };

  transport.onclose = () => {
    console.log(`[MCP] Transport closed for ${serverName}`);
    const entry = mcpClients.get(serverName);
    if (entry) {
      entry.healthy = false;
    }
  };

  await client.connect(transport);
  return client;
}

/**
 * Convert MCP tools to LangChain tools using the official adapter
 * With automatic reconnection on failure
 */
export async function createMCPTools(serverName: string, config: MCPServerConfig) {
  try {
    // Check if client already exists and is healthy
    const existing = mcpClients.get(serverName);
    
    if (existing?.healthy) {
      // Use existing healthy client
      const tools = await loadMcpTools(serverName, existing.client);
      console.log(`📋 Reusing ${tools.length} tools from ${serverName} MCP server`);
      return tools;
    }
    
    // Close unhealthy client if it exists
    if (existing && !existing.healthy) {
      console.log(`[MCP] Reconnecting unhealthy ${serverName} client...`);
      try {
        await existing.client.close();
      } catch {
        // Ignore close errors on unhealthy client
      }
      mcpClients.delete(serverName);
    }

    // Create new client
    const client = await initMCPClient(serverName, config);
    mcpClients.set(serverName, { client, healthy: true });
    console.log(`✅ MCP client connected to ${serverName} server`);

    // Use the official LangChain MCP adapter to load tools
    const tools = await loadMcpTools(serverName, client);
    
    console.log(`📋 Loaded ${tools.length} tools from ${serverName} MCP server`);
    return tools;
  } catch (error) {
    console.error(`Failed to initialize ${serverName} MCP client:`, error);
    // Mark as unhealthy so next call will retry
    const entry = mcpClients.get(serverName);
    if (entry) {
      entry.healthy = false;
    }
    return [];
  }
}

/**
 * Cleanup MCP clients on shutdown
 */
export async function closeMCPClients() {
  for (const [serverName, entry] of mcpClients.entries()) {
    try {
      await entry.client.close();
      console.log(`🔌 Closed MCP client for ${serverName}`);
    } catch (error) {
      console.error(`Error closing MCP client for ${serverName}:`, error);
    }
  }
  mcpClients.clear();
}

// MCP Server Configurations
export const PLAYWRIGHT_MCP_CONFIG: MCPServerConfig = {
  command: 'npx',
  args: ['-y', '@playwright/mcp@latest'],
  env: {
    ...process.env,
    PLAYWRIGHT_HEADLESS: 'true', // Run browser in headless mode
  },
};

export const NEXTJS_DOCS_MCP_CONFIG: MCPServerConfig = {
  command: 'npx',
  args: ['@taiyokimura/nextjs-docs-mcp@latest'],
};

/**
 * Factory functions to create MCP tools for different servers
 */
export async function createPlaywrightMCPTools() {
  return createMCPTools('playwright', PLAYWRIGHT_MCP_CONFIG);
}

export async function createNextJsDocsMCPTools() {
  return createMCPTools('nextjs-docs-mcp', NEXTJS_DOCS_MCP_CONFIG);
}