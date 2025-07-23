import { z } from 'zod';
import { config as dotenvConfig } from 'dotenv';
import type { AppConfig } from '../types/index.js';

// Load environment variables
dotenvConfig();

// Configuration validation schema
const configSchema = z.object({
  github: z.object({
    token: z.string()
      .regex(/^ghp_[a-zA-Z0-9]{36}$/, 'Invalid GitHub token format')
      .describe('GitHub Personal Access Token with repo access'),
    webhookSecret: z.string()
      .min(10, 'Webhook secret must be at least 10 characters')
      .describe('GitHub webhook secret for verification'),
    repo: z.object({
      owner: z.string()
        .min(1, 'Repository owner is required')
        .describe('GitHub repository owner'),
      name: z.string()
        .min(1, 'Repository name is required')
        .describe('GitHub repository name')
    })
  }),
  openai: z.object({
    apiKey: z.string()
      .regex(/^sk-proj-[a-zA-Z0-9\-_]+$/, 'Invalid OpenAI API key format')
      .describe('OpenAI API key for issue classification'),
    model: z.string()
      .default('gpt-4o')
      .describe('OpenAI model to use for classification')
  }),
  triage: z.object({
    labels: z.array(z.string())
      .default(['bug', 'feature-request', 'documentation', 'question', 'enhancement'])
      .describe('Available labels for issue classification'),
    confidenceThreshold: z.number()
      .min(0.1)
      .max(1.0)
      .default(0.75)
      .describe('Minimum confidence score for auto-labeling'),
    autoComment: z.boolean()
      .default(true)
      .describe('Enable automatic first comments on issues')
  }),
  server: z.object({
    port: z.number()
      .int()
      .min(1)
      .max(65535)
      .default(3000)
      .describe('Server port number'),
    environment: z.enum(['development', 'production', 'test'])
      .default('development')
      .describe('Application environment'),
    logLevel: z.enum(['error', 'warn', 'info', 'debug'])
      .default('info')
      .describe('Logging level')
  })
});

// Environment variable mapping
const environmentConfig = {
  github: {
    token: process.env.GITHUB_TOKEN || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET || '',
    repo: {
      owner: process.env.GITHUB_REPO_OWNER || '',
      name: process.env.GITHUB_REPO_NAME || ''
    }
  },
  openai: {
    apiKey: process.env.OPENAI_API_KEY || '',
    model: process.env.OPENAI_MODEL || 'gpt-4o'
  },
  triage: {
    labels: process.env.TRIAGE_LABELS ? 
      process.env.TRIAGE_LABELS.split(',').map(label => label.trim()) : 
      undefined,
    confidenceThreshold: process.env.CONFIDENCE_THRESHOLD ? 
      parseFloat(process.env.CONFIDENCE_THRESHOLD) : 
      undefined,
    autoComment: process.env.AUTO_COMMENT ? 
      process.env.AUTO_COMMENT.toLowerCase() === 'true' : 
      undefined
  },
  server: {
    port: process.env.PORT ? parseInt(process.env.PORT, 10) : undefined,
    environment: process.env.NODE_ENV as 'development' | 'production' | 'test' | undefined,
    logLevel: process.env.LOG_LEVEL as 'error' | 'warn' | 'info' | 'debug' | undefined
  }
};

// Validate and export configuration
let config: AppConfig;

try {
  config = configSchema.parse(environmentConfig);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('Configuration validation failed:');
    error.errors.forEach(err => {
      console.error(`  ${err.path.join('.')}: ${err.message}`);
    });
    process.exit(1);
  }
  throw error;
}

// Helper function to get sanitized config for logging
export function getSanitizedConfig(): Record<string, any> {
  const sanitized = JSON.parse(JSON.stringify(config));
  
  // Redact sensitive values
  if (sanitized.github?.token) sanitized.github.token = '[REDACTED]';
  if (sanitized.github?.webhookSecret) sanitized.github.webhookSecret = '[REDACTED]';
  if (sanitized.openai?.apiKey) sanitized.openai.apiKey = '[REDACTED]';
  
  return sanitized;
}

// Validation helper for runtime config updates
export function validatePartialConfig(updates: Partial<AppConfig>): z.SafeParseReturnType<Partial<AppConfig>, Partial<AppConfig>> {
  const partialSchema = configSchema.partial();
  return partialSchema.safeParse(updates);
}

export { config };
export default config;