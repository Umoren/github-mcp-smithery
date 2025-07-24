import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { config } from './config/index.js';
import { log, generateCorrelationId } from './utils/logger.js';
import TriageOrchestrator from './services/orchestrator.js';
import type { GitHubWebhookPayload } from './types/index.js';

// MCP Server configuration schema (matches smithery.yaml)
export const configSchema = z.object({
  debug: z.boolean().default(false).describe("Enable debug logging"),
  githubToken: z.string().describe("GitHub Personal Access Token with repo scope"),
  githubWebhookSecret: z.string().describe("GitHub webhook secret for verification"),
  openaiApiKey: z.string().describe("OpenAI API key for issue classification"),
  githubRepoOwner: z.string().describe("GitHub repository owner username"),
  githubRepoName: z.string().describe("GitHub repository name"),
  openaiModel: z.string().default("gpt-4o").describe("OpenAI model to use for classification"),
  confidenceThreshold: z.number().default(0.75).describe("Minimum confidence score for auto-labeling (0.0-1.0)"),
  autoComment: z.boolean().default(true).describe("Enable automatic triage comments on issues"),
  triageLabels: z.string().default("bug,feature-request,documentation,question,enhancement").describe("Comma-separated list of available classification labels"),
});

export default function createStatelessServer({
  config: mcpConfig,
}: {
  config: z.infer<typeof configSchema>;
}) {
  const server = new McpServer({
    name: "GitHub Issue Auto-Triage Agent",
    version: "1.0.0",
  });

  // Lazy initialization of services - only when configuration is available
  let orchestrator: TriageOrchestrator | null = null;
  
  const getOrchestrator = () => {
    if (!orchestrator) {
      orchestrator = new TriageOrchestrator();
    }
    return orchestrator;
  };

  // MCP Tools for manual operations
  server.tool(
    "triage_issue",
    "Manually trigger triage for a specific GitHub issue",
    {
      issueNumber: z.number().describe("GitHub issue number"),
      title: z.string().describe("Issue title"),
      body: z.string().describe("Issue body"),
      author: z.string().describe("Issue author"),
    },
    async ({ issueNumber, title, body, author }) => {
      const correlationId = generateCorrelationId();
      
      try {
        // Create mock payload for manual triage
        const mockPayload: GitHubWebhookPayload = {
          action: 'opened',
          issue: {
            id: Date.now(),
            number: issueNumber,
            title,
            body,
            state: 'open',
            user: { login: author, id: 1 },
            labels: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            html_url: `https://github.com/${config.github.repo.owner}/${config.github.repo.name}/issues/${issueNumber}`,
            repository_url: `https://api.github.com/repos/${config.github.repo.owner}/${config.github.repo.name}`
          },
          repository: {
            id: 1,
            name: config.github.repo.name,
            full_name: `${config.github.repo.owner}/${config.github.repo.name}`,
            owner: { login: config.github.repo.owner, id: 1 },
            html_url: `https://github.com/${config.github.repo.owner}/${config.github.repo.name}`
          },
          sender: { login: author, id: 1 }
        };

        const result = await getOrchestrator().triageIssue(mockPayload, correlationId);

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                success: result.success,
                classification: result.classification,
                labelsApplied: result.labelsApplied,
                commentPosted: result.commentPosted,
                correlationId
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text", 
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "health_check",
    "Check the health of all triage services",
    {},
    async () => {
      const correlationId = generateCorrelationId();
      
      try {
        const health = await getOrchestrator().healthCheck(correlationId);
        
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                timestamp: new Date().toISOString(),
                overall: health.overall,
                services: health.services,
                correlationId
              }, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text",
              text: `Health check failed: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ]
        };
      }
    }
  );

  server.tool(
    "get_config",
    "Get current triage configuration",
    {},
    async () => {
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              triage: config.triage,
              server: {
                port: config.server.port,
                environment: config.server.environment,
                logLevel: config.server.logLevel
              },
              github: {
                repo: config.github.repo
              }
            }, null, 2)
          }
        ]
      };
    }
  );

  server.tool(
    "create_and_triage_issue",
    "Create a new GitHub issue and automatically triage it",
    {
      title: z.string().describe("Issue title"),
      body: z.string().describe("Issue description/body"),
      issueType: z.enum(["bug", "feature", "documentation", "question"]).optional().describe("Expected issue type for validation")
    },
    async ({ title, body, issueType }) => {
      const correlationId = generateCorrelationId();
      
      try {
        // Import GitHub client dynamically
        const { default: GitHubClient } = await import('./services/github.js');
        const githubClient = new GitHubClient();
        
        // Create the GitHub issue
        const createdIssue = await githubClient.createIssue(title, body, correlationId);
        
        // Create mock payload for triage
        const mockPayload: GitHubWebhookPayload = {
          action: 'opened',
          issue: {
            id: createdIssue.id,
            number: createdIssue.number,
            title,
            body,
            state: 'open',
            user: { login: 'api-user', id: 1 },
            labels: [],
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
            html_url: createdIssue.html_url,
            repository_url: `https://api.github.com/repos/${config.github.repo.owner}/${config.github.repo.name}`
          },
          repository: {
            id: 1,
            name: config.github.repo.name,
            full_name: `${config.github.repo.owner}/${config.github.repo.name}`,
            owner: { login: config.github.repo.owner, id: 1 },
            html_url: `https://github.com/${config.github.repo.owner}/${config.github.repo.name}`
          },
          sender: { login: 'api-user', id: 1 }
        };

        // Triage the issue
        const triageResult = await getOrchestrator().triageIssue(mockPayload, correlationId);

        const result = {
          success: true,
          issueCreated: {
            number: createdIssue.number,
            url: createdIssue.html_url,
            title
          },
          triage: {
            classification: triageResult.classification,
            labelsApplied: triageResult.labelsApplied,
            commentPosted: triageResult.commentPosted
          },
          expectedType: issueType,
          correctClassification: issueType ? triageResult.classification?.primaryLabel === issueType : null,
          correlationId
        };

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result, null, 2)
            }
          ]
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text", 
              text: `Error: ${error instanceof Error ? error.message : 'Unknown error'}`
            }
          ]
        };
      }
    }
  );

  // Log server startup
  log.info('GitHub Auto-Triage MCP Server initialized', {
    repository: `${config.github.repo.owner}/${config.github.repo.name}`,
    component: 'mcp-server'
  });

  return server.server;
}
