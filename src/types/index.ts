export interface GitHubIssue {
  id: number;
  number: number;
  title: string;
  body: string | null;
  state: 'open' | 'closed';
  user: {
    login: string;
    id: number;
  };
  assignee?: {
    login: string;
    id: number;
  } | null;
  labels: Array<{
    id: number;
    name: string;
    color: string;
  }>;
  created_at: string;
  updated_at: string;
  html_url: string;
  repository_url: string;
}

export interface GitHubWebhookPayload {
  action: 'opened' | 'edited' | 'closed' | 'reopened' | 'assigned' | 'unassigned' | 'labeled' | 'unlabeled';
  issue: GitHubIssue;
  repository: {
    id: number;
    name: string;
    full_name: string;
    owner: {
      login: string;
      id: number;
    };
    html_url: string;
  };
  sender: {
    login: string;
    id: number;
  };
}

export interface ClassificationResult {
  primaryLabel: string;
  confidence: number;
  reasoning: string;
  additionalLabels?: string[];
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

export interface TriageContext {
  title: string;
  body: string;
  author: string;
  repository: string;
  existingLabels: string[];
  createdAt: string;
}

export interface TriageResult {
  success: boolean;
  classification?: ClassificationResult;
  labelsApplied?: string[];
  commentPosted?: boolean;
  error?: string;
}

export interface AppConfig {
  github: {
    token: string;
    webhookSecret: string;
    repo: {
      owner: string;
      name: string;
    };
  };
  openai: {
    apiKey: string;
    model: string;
  };
  triage: {
    labels: string[];
    confidenceThreshold: number;
    autoComment: boolean;
  };
  server: {
    port: number;
    environment: 'development' | 'production' | 'test';
    logLevel: 'error' | 'warn' | 'info' | 'debug';
  };
}

export interface LogContext {
  correlationId?: string;
  issueNumber?: number;
  repository?: string;
  userId?: string;
  action?: string;
  [key: string]: any; // Allow additional logging properties
}

export interface RetryOptions {
  retries: number;
  factor: number;
  minTimeout: number;
  maxTimeout: number;
}

export interface MCPTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  handler: (params: any) => Promise<any>;
}