import crypto from 'crypto';
import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { config } from '../config/index.js';
import { log, triageLog, generateCorrelationId } from '../utils/logger.js';
import { 
  WebhookVerificationError, 
  WebhookPayloadError, 
  ValidationError 
} from '../utils/errors.js';
import type { GitHubWebhookPayload, GitHubIssue, TriageResult } from '../types/index.js';

// GitHub webhook payload validation schema
const webhookPayloadSchema = z.object({
  action: z.enum(['opened', 'edited', 'closed', 'reopened', 'assigned', 'unassigned', 'labeled', 'unlabeled']),
  issue: z.object({
    id: z.number(),
    number: z.number(),
    title: z.string(),
    body: z.string().nullable(),
    state: z.enum(['open', 'closed']),
    user: z.object({
      login: z.string(),
      id: z.number()
    }),
    assignee: z.object({
      login: z.string(),
      id: z.number()
    }).nullable().optional(),
    labels: z.array(z.object({
      id: z.number(),
      name: z.string(),
      color: z.string()
    })),
    created_at: z.string(),
    updated_at: z.string(),
    html_url: z.string(),
    repository_url: z.string()
  }),
  repository: z.object({
    id: z.number(),
    name: z.string(),
    full_name: z.string(),
    owner: z.object({
      login: z.string(),
      id: z.number()
    }),
    html_url: z.string()
  }),
  sender: z.object({
    login: z.string(),
    id: z.number()
  })
});

export class WebhookHandler {
  private readonly secret: string;

  constructor() {
    this.secret = config.github.webhookSecret;
  }

  // Verify GitHub webhook signature
  private verifySignature(payload: string, signature: string): boolean {
    if (!signature) {
      return false;
    }

    // GitHub sends signature in format: sha256=<signature>
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    const receivedSignature = signature.slice(7); // Remove 'sha256=' prefix
    const expectedSignature = crypto
      .createHmac('sha256', this.secret)
      .update(payload, 'utf8')
      .digest('hex');

    // Use timingSafeEqual to prevent timing attacks
    return crypto.timingSafeEqual(
      Buffer.from(receivedSignature, 'hex'),
      Buffer.from(expectedSignature, 'hex')
    );
  }

  // Validate webhook payload structure
  private validatePayload(payload: any): GitHubWebhookPayload {
    try {
      return webhookPayloadSchema.parse(payload);
    } catch (error) {
      if (error instanceof z.ZodError) {
        const errorMessage = error.errors
          .map(err => `${err.path.join('.')}: ${err.message}`)
          .join(', ');
        throw new WebhookPayloadError(`Invalid payload structure: ${errorMessage}`);
      }
      throw new WebhookPayloadError('Failed to validate payload');
    }
  }

  // Check if the webhook is for our target repository
  private isTargetRepository(payload: GitHubWebhookPayload): boolean {
    const { owner, name } = config.github.repo;
    return (
      payload.repository.owner.login === owner &&
      payload.repository.name === name
    );
  }

  // Check if the webhook action should trigger triage
  private shouldTriggerTriage(payload: GitHubWebhookPayload): boolean {
    // Only triage when issues are opened or edited
    const triggerActions = ['opened', 'edited'];
    return triggerActions.includes(payload.action) && payload.issue.state === 'open';
  }

  // Express middleware for webhook signature verification
  public verifyWebhookMiddleware = (req: Request, res: Response, next: NextFunction): void => {
    const correlationId = generateCorrelationId();
    req.correlationId = correlationId;

    try {
      const signature = req.get('X-Hub-Signature-256');
      const payload = JSON.stringify(req.body);

      if (!signature) {
        throw new WebhookVerificationError('Missing signature header');
      }

      if (!this.verifySignature(payload, signature)) {
        log.warn('Webhook signature verification failed', {
          correlationId,
          signature: signature.slice(0, 16) + '...',
          component: 'webhook-handler'
        });
        throw new WebhookVerificationError();
      }

      log.debug('Webhook signature verified successfully', {
        correlationId,
        component: 'webhook-handler'
      });

      next();
    } catch (error) {
      if (error instanceof WebhookVerificationError) {
        res.status(error.statusCode).json({
          error: 'Unauthorized',
          message: error.message
        });
      } else {
        log.error('Unexpected error during webhook verification', { correlationId }, error as Error);
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to verify webhook'
        });
      }
    }
  };

  // Main webhook handler
  public handleWebhook = async (req: Request, res: Response): Promise<void> => {
    const correlationId = req.correlationId || generateCorrelationId();
    
    try {
      // Validate payload structure
      const payload = this.validatePayload(req.body);
      
      triageLog.webhookReceived(
        payload.issue.number,
        payload.action,
        correlationId
      );

      // Check if this is for our target repository
      if (!this.isTargetRepository(payload)) {
        log.debug('Webhook received for different repository, ignoring', {
          correlationId,
          repository: payload.repository.full_name,
          targetRepository: `${config.github.repo.owner}/${config.github.repo.name}`,
          component: 'webhook-handler'
        });
        
        res.status(200).json({ 
          message: 'Webhook received but not for target repository',
          processed: false 
        });
        return;
      }

      // Check if we should trigger triage for this action
      if (!this.shouldTriggerTriage(payload)) {
        log.debug('Webhook action does not trigger triage', {
          correlationId,
          action: payload.action,
          issueState: payload.issue.state,
          issueNumber: payload.issue.number,
          component: 'webhook-handler'
        });

        res.status(200).json({ 
          message: 'Webhook received but action does not trigger triage',
          processed: false 
        });
        return;
      }

      // Process the issue triage asynchronously
      // We respond immediately to GitHub and process in background
      res.status(200).json({ 
        message: 'Webhook received and processing started',
        processed: true,
        correlationId 
      });

      // Process the issue triage in background (import will be added dynamically)
      setImmediate(async () => {
        try {
          // Dynamic import to avoid circular dependency
          const { default: TriageOrchestrator } = await import('../services/orchestrator.js');
          const orchestrator = new TriageOrchestrator();
          await orchestrator.triageIssue(payload, correlationId);
        } catch (error) {
          log.error('Background triage processing failed', { correlationId }, error as Error);
        }
      });

      log.info('Webhook processing initiated', {
        correlationId,
        issueNumber: payload.issue.number,
        action: payload.action,
        component: 'webhook-handler'
      });

    } catch (error) {
      log.error('Webhook processing failed', { correlationId }, error as Error);

      if (error instanceof WebhookPayloadError || error instanceof ValidationError) {
        res.status(error.statusCode).json({
          error: error.name,
          message: error.message,
          correlationId
        });
      } else {
        res.status(500).json({
          error: 'Internal Server Error',
          message: 'Failed to process webhook',
          correlationId
        });
      }
    }
  };

  // Health check endpoint for webhook
  public healthCheck = (_req: Request, res: Response): void => {
    res.status(200).json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      service: 'github-webhook-handler'
    });
  };

  // Utility method to extract issue context for triage
  public extractTriageContext(payload: GitHubWebhookPayload) {
    return {
      title: payload.issue.title,
      body: payload.issue.body || '',
      author: payload.issue.user.login,
      repository: payload.repository.full_name,
      existingLabels: payload.issue.labels.map(label => label.name),
      createdAt: payload.issue.created_at
    };
  }

  // Method to handle webhook payload for testing
  public async processWebhookPayload(payload: GitHubWebhookPayload, correlationId: string): Promise<TriageResult> {
    // This method will be used by the triage orchestrator
    // For now, return a placeholder result
    return {
      success: true,
      classification: {
        primaryLabel: 'pending-triage',
        confidence: 0.0,
        reasoning: 'Processing not yet implemented'
      }
    };
  }
}

// Extend Express Request interface to include correlationId
declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export default WebhookHandler;