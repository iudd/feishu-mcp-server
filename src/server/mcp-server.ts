import type { ApiClientConfig } from '@/client/types.js';
import { API_ENDPOINT } from '@/consts/index.js';
import logger from '@/logger/index.js';
import { FeiShuServices } from '@/services/index.js';
import type { ServerConfig } from '@/typings/index.js';
import fastifyCors from '@fastify/cors';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fastify from 'fastify';
import { FastifySSETransport } from './adapters/fastify-sse.js';
import { registerAllTools } from './tools/index.js';
/**
 * MCP Server Implementation
 *
 * Core server implementation that handles connections and tool registration.
 */

/**
 * FeiShu MCP Server
 *
 * Manages FeiShu API interaction through the Model Context Protocol.
 */
export class FeiShuMcpServer {
  /** MCP server instance */
  private server: McpServer;
  /** FeiShu services */
  private services: FeiShuServices;
  /** SSE transport instance for HTTP mode */
  private sseTransport: FastifySSETransport | null = null;
  /** Server version */
  private readonly version = '0.0.1';
  /** Server configuration */
  private config: ServerConfig;

  /**
   * Create a new FeiShu MCP server
   *
   * @param config - Server configuration
   */
  constructor(config: ServerConfig) {
    this.config = config;
    
    // Initialize FeiShu services
    const apiConfig: ApiClientConfig = {
      appId: config.feishuAppId,
      appSecret: config.feishuAppSecret,
      apiEndpoint: API_ENDPOINT,
      logger,
    };

    this.services = new FeiShuServices(apiConfig);

    // Initialize MCP server
    this.server = new McpServer(
      {
        name: 'FeiShu MCP Server',
        version: this.version,
      },
      {
        capabilities: {
          logging: {},
          tools: {},
        },
      },
    );

    // Register all tools
    this.registerTools();
  }

  /**
   * Register all MCP tools
   */
  private registerTools(): void {
    registerAllTools({
      server: this.server,
      services: this.services,
      logger,
    });
  }

  /**
   * Connect to a transport
   *
   * @param transport - Transport instance
   */
  async connect(transport: any): Promise<void> {
    await this.server.connect(transport);
    logger.info('Server connected and ready to process requests');
  }

  /**
   * Start HTTP server
   *
   * @param port - Server port
   */
  async startHttpServer(port: number): Promise<void> {
    const app = fastify({
      logger: true,
      disableRequestLogging: true, // Disable default request logging as we use custom logging
    });

    await app.register(fastifyCors);
    await this.configureFastifyServer(app);

    try {
      await app.listen({ port, host: '0.0.0.0' });
      logger.info(`HTTP server listening on port ${port}`);
      logger.info(`SSE endpoint available at http://localhost:${port}/sse`);
      logger.info(
        `Message endpoint available at http://localhost:${port}/messages`,
      );
    } catch (err) {
      logger.error('Error starting server:', err);
      process.exit(1);
    }
  }

  /**
   * Configure Fastify server
   *
   * @param app - Fastify instance
   */
  private async configureFastifyServer(app: FastifyInstance): Promise<void> {
    // Health check endpoint
    app.get('/health', async (request: FastifyRequest, reply: FastifyReply) => {
      return {
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: this.version,
        feishuAppId: this.config.feishuAppId ? this.config.feishuAppId.substring(0, 8) + '****' : 'not set',
        feishuAppSecret: this.config.feishuAppSecret ? 'configured' : 'not configured'
      };
    });

    // Debug endpoint to test Feishu connection
    app.get('/debug', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Test Feishu API connection
        const testResult = await this.testFeishuConnection();
        return {
          status: 'debug',
          timestamp: new Date().toISOString(),
          config: {
            feishuAppId: this.config.feishuAppId ? this.config.feishuAppId.substring(0, 8) + '****' : 'not set',
            feishuAppSecret: this.config.feishuAppSecret ? 'configured' : 'not configured',
            apiEndpoint: API_ENDPOINT
          },
          feishuTest: testResult
        };
      } catch (err) {
        logger.error('Debug endpoint error:', err);
        reply.code(500).send({ 
          error: 'Debug failed', 
          message: err instanceof Error ? err.message : 'Unknown error'
        });
      }
    });

    // SSE endpoint
    app.get('/sse', async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        logger.info('New SSE connection established');
        this.sseTransport = new FastifySSETransport('/messages', reply);
        await this.server.connect(this.sseTransport);
        await this.sseTransport.initializeSSE();
        request.raw.on('close', () => {
          logger.info('SSE connection closed');
          this.sseTransport?.close();
          this.sseTransport = null;
        });
      } catch (err) {
        logger.error('Error establishing SSE connection:', err);
        reply.code(500).send({ error: 'Internal Server Error' });
      }
    });

    // Message handling endpoint
    app.post(
      '/messages',
      async (request: FastifyRequest, reply: FastifyReply) => {
        try {
          if (!this.sseTransport) {
            reply.code(400).send({ error: 'No active SSE connection' });
            return;
          }
          await this.sseTransport.handleFastifyRequest(request, reply);
        } catch (err) {
          logger.error('Error handling message:', err);
          reply.code(500).send({ error: 'Internal Server Error' });
        }
      },
    );
  }

  /**
   * Test Feishu API connection
   */
  private async testFeishuConnection(): Promise<any> {
    try {
      // Try to get bot info as a basic connection test
      const response = await fetch(`${API_ENDPOINT}/open-apis/bot/v3/info`, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${await this.getAccessToken()}`,
          'Content-Type': 'application/json'
        }
      });

      if (response.ok) {
        const data = await response.json();
        return { success: true, data };
      } else {
        const errorData = await response.text();
        return { 
          success: false, 
          status: response.status,
          statusText: response.statusText,
          error: errorData
        };
      }
    } catch (err) {
      return { 
        success: false, 
        error: err instanceof Error ? err.message : 'Unknown error'
      };
    }
  }

  /**
   * Get Feishu access token
   */
  private async getAccessToken(): Promise<string> {
    try {
      const response = await fetch(`${API_ENDPOINT}/open-apis/auth/v3/tenant_access_token/internal`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: this.config.feishuAppId,
          app_secret: this.config.feishuAppSecret
        })
      });

      if (!response.ok) {
        throw new Error(`Token request failed: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();
      if (data.code !== 0) {
        throw new Error(`Token error: ${data.msg}`);
      }

      return data.tenant_access_token;
    } catch (err) {
      logger.error('Failed to get access token:', err);
      throw err;
    }
  }
}