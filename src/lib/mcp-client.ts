import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { loadMcpTools } from '@langchain/mcp-adapters';

// MCP Server configuration
interface MCPServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

// Cache for MCP clients
const mcpClients = new Map<string, Client>();

/**
 * Initialize an MCP client for a specific server
 */
async function initMCPClient(config: MCPServerConfig): Promise<Client> {
  const client = new Client({
    name: 'codevibe-mcp-client',
    version: '1.0.0',
  });

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    env: config.env,
  });

  await client.connect(transport);
  return client;
}

/**
 * Convert MCP tools to LangChain tools using the official adapter
 */
export async function createMCPTools(serverName: string, config: MCPServerConfig) {
  try {
    // Check if client already exists
    let client = mcpClients.get(serverName);
    
    if (!client) {
      client = await initMCPClient(config);
      mcpClients.set(serverName, client);
      console.log(`✅ MCP client connected to ${serverName} server`);
    }

    // Use the official LangChain MCP adapter to load tools
    const tools = await loadMcpTools(serverName, client);
    
    console.log(`📋 Loaded ${tools.length} tools from ${serverName} MCP server`);
    return tools;
  } catch (error) {
    console.error(`Failed to initialize ${serverName} MCP client:`, error);
    return [];
  }
}

/**
 * Cleanup MCP clients on shutdown
 */
export async function closeMCPClients() {
  for (const [serverName, client] of mcpClients.entries()) {
    try {
      await client.close();
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