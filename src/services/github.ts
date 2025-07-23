import { config } from '../config/index.js';
import { log, triageLog, performanceLog } from '../utils/logger.js';
import { 
  GitHubApiError, 
  GitHubAuthError,
  GitHubRateLimitError,
  TimeoutError,
  ValidationError 
} from '../utils/errors.js';
import type { 
  ClassificationResult, 
  LogContext 
} from '../types/index.js';

// GitHub API types
interface GitHubLabel {
  id: number;
  name: string;
  color: string;
  description?: string;
}

interface GitHubComment {
  id: number;
  body: string;
  user: {
    login: string;
  };
  created_at: string;
  updated_at: string;
}

interface GitHubApiResponse<T> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

export class GitHubClient {
  private readonly token: string;
  private readonly baseUrl = 'https://api.github.com';
  private readonly timeout = 30000; // 30 second timeout
  private readonly userAgent = 'github-triage-agent/1.0.0';

  constructor() {
    this.token = config.github.token;
  }

  // Make authenticated request to GitHub API
  private async makeRequest<T>(
    endpoint: string, 
    options: {
      method?: string;
      body?: any;
      correlationId: string;
    }
  ): Promise<GitHubApiResponse<T>> {
    const { method = 'GET', body, correlationId } = options;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}${endpoint}`, {
        method,
        headers: {
          'Authorization': `Bearer ${this.token}`,
          'Accept': 'application/vnd.github.v3+json',
          'Content-Type': 'application/json',
          'User-Agent': this.userAgent
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      // Handle rate limiting
      if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
        const resetTime = response.headers.get('x-ratelimit-reset');
        const resetTimeMs = resetTime ? parseInt(resetTime, 10) * 1000 : undefined;
        
        throw new GitHubRateLimitError(
          'GitHub API rate limit exceeded',
          resetTimeMs,
          { correlationId }
        );
      }

      // Handle authentication errors
      if (response.status === 401) {
        throw new GitHubAuthError('GitHub API authentication failed', { correlationId });
      }

      // Handle other client/server errors
      if (!response.ok) {
        let errorMessage = `HTTP ${response.status}`;
        
        try {
          const errorData = await response.json();
          errorMessage = errorData.message || errorMessage;
        } catch {
          // Ignore JSON parsing errors for error responses
        }

        throw new GitHubApiError(errorMessage, response.status, { correlationId });
      }

      const data = await response.json();
      
      // Log rate limit info for monitoring
      const remaining = response.headers.get('x-ratelimit-remaining');
      const reset = response.headers.get('x-ratelimit-reset');
      
      log.debug('GitHub API request successful', {
        correlationId,
        endpoint,
        method,
        rateLimitRemaining: remaining,
        rateLimitReset: reset,
        component: 'github-client'
      });

      return {
        data,
        status: response.status,
        headers: Object.fromEntries(response.headers.entries())
      };

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError('GitHub API request', this.timeout, { correlationId });
      }

      // Re-throw our custom errors
      if (error instanceof GitHubApiError || 
          error instanceof GitHubAuthError || 
          error instanceof GitHubRateLimitError) {
        throw error;
      }

      // Wrap other errors
      throw new GitHubApiError(
        `Request failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        undefined,
        { correlationId }
      );
    }
  }

  // Get current labels on an issue
  public async getIssueLabels(issueNumber: number, correlationId: string): Promise<string[]> {
    const timer = performanceLog.startTimer('get-issue-labels', correlationId);
    
    try {
      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}/issues/${issueNumber}/labels`;
      
      const response = await this.makeRequest<GitHubLabel[]>(endpoint, { correlationId });
      
      const labels = response.data.map(label => label.name);
      
      timer.end();
      
      log.debug('Retrieved issue labels', {
        correlationId,
        issueNumber,
        labels,
        component: 'github-client'
      });

      return labels;

    } catch (error) {
      timer.end();
      log.error('Failed to get issue labels', { correlationId, issueNumber }, error as Error);
      throw error;
    }
  }

  // Add labels to an issue
  public async addLabelsToIssue(
    issueNumber: number, 
    labels: string[], 
    correlationId: string
  ): Promise<string[]> {
    const timer = performanceLog.startTimer('add-labels-to-issue', correlationId);
    
    try {
      if (labels.length === 0) {
        log.debug('No labels to add', { correlationId, issueNumber, component: 'github-client' });
        timer.end();
        return [];
      }

      triageLog.labelingStarted(issueNumber, labels, correlationId);

      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}/issues/${issueNumber}/labels`;
      
      const response = await this.makeRequest<GitHubLabel[]>(endpoint, {
        method: 'POST',
        body: { labels },
        correlationId
      });

      const addedLabels = response.data.map(label => label.name);
      
      triageLog.labelingCompleted(issueNumber, addedLabels, correlationId);
      
      const duration = timer.end();
      
      log.info('Labels added to issue', {
        correlationId,
        issueNumber,
        labelsAdded: addedLabels,
        duration,
        component: 'github-client'
      });

      return addedLabels;

    } catch (error) {
      timer.end();
      log.error('Failed to add labels to issue', { correlationId, issueNumber, labels }, error as Error);
      throw error;
    }
  }

  // Remove labels from an issue
  public async removeLabelsFromIssue(
    issueNumber: number, 
    labels: string[], 
    correlationId: string
  ): Promise<void> {
    if (labels.length === 0) {
      return;
    }

    const timer = performanceLog.startTimer('remove-labels-from-issue', correlationId);
    
    try {
      const { owner, name } = config.github.repo;
      
      // GitHub API requires removing labels one by one
      const removePromises = labels.map(async (label) => {
        const endpoint = `/repos/${owner}/${name}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`;
        
        try {
          await this.makeRequest(endpoint, {
            method: 'DELETE',
            correlationId
          });
          
          log.debug('Label removed from issue', {
            correlationId,
            issueNumber,
            label,
            component: 'github-client'
          });
          
        } catch (error) {
          // Log but don't fail if label doesn't exist
          if (error instanceof GitHubApiError && error.apiStatusCode === 404) {
            log.debug('Label not found on issue (already removed)', {
              correlationId,
              issueNumber,
              label,
              component: 'github-client'
            });
          } else {
            throw error;
          }
        }
      });

      await Promise.all(removePromises);
      
      const duration = timer.end();
      
      log.info('Labels removed from issue', {
        correlationId,
        issueNumber,
        labelsRemoved: labels,
        duration,
        component: 'github-client'
      });

    } catch (error) {
      timer.end();
      log.error('Failed to remove labels from issue', { correlationId, issueNumber, labels }, error as Error);
      throw error;
    }
  }

  // Generate comment text based on classification
  private generateTriageComment(classification: ClassificationResult): string {
    const { primaryLabel, confidence, reasoning, severity } = classification;
    
    let comment = `🤖 **Auto-Triage Results**\n\n`;
    comment += `This issue has been automatically classified as: **${primaryLabel}**\n`;
    comment += `Confidence: ${Math.round(confidence * 100)}%\n\n`;
    
    if (reasoning) {
      comment += `**Reasoning:** ${reasoning}\n\n`;
    }
    
    if (severity && primaryLabel === 'bug') {
      const severityEmoji = {
        critical: '🚨',
        high: '⚠️',
        medium: '⚡',
        low: '📝'
      };
      
      comment += `**Severity:** ${severityEmoji[severity]} ${severity.toUpperCase()}\n\n`;
    }
    
    if (classification.additionalLabels && classification.additionalLabels.length > 0) {
      comment += `**Additional labels suggested:** ${classification.additionalLabels.join(', ')}\n\n`;
    }
    
    comment += `---\n`;
    comment += `*This classification was generated automatically. If you believe this is incorrect, please feel free to update the labels manually.*`;
    
    return comment;
  }

  // Create a new GitHub issue
  public async createIssue(
    title: string,
    body: string,
    correlationId: string
  ): Promise<{
    number: number;
    html_url: string;
    id: number;
  }> {
    const timer = performanceLog.startTimer('create-github-issue', correlationId);
    
    try {
      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}/issues`;
      
      const response = await this.makeRequest<{
        number: number;
        html_url: string;
        id: number;
        title: string;
        body: string;
      }>(endpoint, {
        method: 'POST',
        body: { title, body },
        correlationId
      });

      const duration = timer.end();
      
      log.info('GitHub issue created', {
        correlationId,
        issueNumber: response.data.number,
        title: response.data.title,
        url: response.data.html_url,
        duration,
        component: 'github-client'
      });

      return {
        number: response.data.number,
        html_url: response.data.html_url,
        id: response.data.id
      };

    } catch (error) {
      timer.end();
      log.error('Failed to create GitHub issue', { correlationId, title }, error as Error);
      throw error;
    }
  }

  // Post a comment on an issue
  public async postCommentToIssue(
    issueNumber: number, 
    classification: ClassificationResult, 
    correlationId: string
  ): Promise<void> {
    if (!config.triage.autoComment) {
      log.debug('Auto-commenting is disabled', { correlationId, issueNumber, component: 'github-client' });
      return;
    }

    const timer = performanceLog.startTimer('post-comment-to-issue', correlationId);
    
    try {
      const commentBody = this.generateTriageComment(classification);
      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}/issues/${issueNumber}/comments`;
      
      await this.makeRequest<GitHubComment>(endpoint, {
        method: 'POST',
        body: { body: commentBody },
        correlationId
      });

      triageLog.commentPosted(issueNumber, correlationId);
      
      const duration = timer.end();
      
      log.info('Comment posted to issue', {
        correlationId,
        issueNumber,
        duration,
        component: 'github-client'
      });

    } catch (error) {
      timer.end();
      log.error('Failed to post comment to issue', { correlationId, issueNumber }, error as Error);
      throw error;
    }
  }

  // Get repository information
  public async getRepositoryInfo(correlationId: string): Promise<any> {
    try {
      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}`;
      
      const response = await this.makeRequest(endpoint, { correlationId });
      
      log.debug('Retrieved repository info', {
        correlationId,
        repository: `${owner}/${name}`,
        component: 'github-client'
      });

      return response.data;

    } catch (error) {
      log.error('Failed to get repository info', { correlationId }, error as Error);
      throw error;
    }
  }

  // Health check method
  public async healthCheck(correlationId: string): Promise<boolean> {
    try {
      await this.getRepositoryInfo(correlationId);
      return true;
    } catch (error) {
      log.error('GitHub client health check failed', { correlationId }, error as Error);
      return false;
    }
  }

  // Get rate limit status
  public async getRateLimitStatus(correlationId: string): Promise<{
    limit: number;
    remaining: number;
    reset: number;
    used: number;
  }> {
    try {
      const response = await this.makeRequest('/rate_limit', { correlationId });
      
      const { limit, remaining, reset, used } = (response.data as any).rate;
      
      log.debug('Retrieved rate limit status', {
        correlationId,
        limit,
        remaining,
        reset,
        used,
        component: 'github-client'
      });

      return { limit, remaining, reset, used };

    } catch (error) {
      log.error('Failed to get rate limit status', { correlationId }, error as Error);
      throw error;
    }
  }

  // Validate that required labels exist in the repository
  public async validateRepositoryLabels(correlationId: string): Promise<{
    existing: string[];
    missing: string[];
  }> {
    try {
      const { owner, name } = config.github.repo;
      const endpoint = `/repos/${owner}/${name}/labels`;
      
      const response = await this.makeRequest<GitHubLabel[]>(endpoint, { correlationId });
      
      const existingLabels = response.data.map(label => label.name);
      const requiredLabels = config.triage.labels;
      const missingLabels = requiredLabels.filter(label => !existingLabels.includes(label));
      
      log.info('Repository label validation completed', {
        correlationId,
        existingLabels,
        missingLabels,
        component: 'github-client'
      });

      return {
        existing: existingLabels.filter(label => requiredLabels.includes(label)),
        missing: missingLabels
      };

    } catch (error) {
      log.error('Failed to validate repository labels', { correlationId }, error as Error);
      throw error;
    }
  }
}

export default GitHubClient;