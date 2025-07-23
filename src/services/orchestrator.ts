import { config } from '../config/index.js';
import { log, triageLog, generateCorrelationId } from '../utils/logger.js';
import OpenAIClassifier from './classifier.js';
import GitHubClient from './github.js';
import type { 
  GitHubWebhookPayload, 
  TriageContext, 
  TriageResult,
  ClassificationResult 
} from '../types/index.js';

export class TriageOrchestrator {
  private classifier: OpenAIClassifier;
  private githubClient: GitHubClient;

  constructor() {
    this.classifier = new OpenAIClassifier();
    this.githubClient = new GitHubClient();
  }

  // Main triage orchestration method
  public async triageIssue(payload: GitHubWebhookPayload, correlationId: string): Promise<TriageResult> {
    try {
      log.info('Starting issue triage', {
        correlationId,
        issueNumber: payload.issue.number,
        action: payload.action,
        repository: payload.repository.full_name,
        component: 'triage-orchestrator'
      });

      // Extract context for classification
      const context: TriageContext = {
        title: payload.issue.title,
        body: payload.issue.body || '',
        author: payload.issue.user.login,
        repository: payload.repository.full_name,
        existingLabels: payload.issue.labels.map(label => label.name),
        createdAt: payload.issue.created_at
      };

      // Step 1: Classify the issue
      const classification = await this.classifier.classifyIssue(context, correlationId);

      // Step 2: Apply labels (only if classification confidence is high enough)
      const labelsToAdd = [classification.primaryLabel];
      if (classification.additionalLabels) {
        labelsToAdd.push(...classification.additionalLabels);
      }

      // Filter out labels that already exist
      const newLabels = labelsToAdd.filter(label => 
        !context.existingLabels.includes(label)
      );

      let labelsApplied: string[] = [];
      if (newLabels.length > 0) {
        labelsApplied = await this.githubClient.addLabelsToIssue(
          payload.issue.number,
          newLabels,
          correlationId
        );
      }

      // Step 3: Post triage comment
      let commentPosted = false;
      if (config.triage.autoComment) {
        try {
          await this.githubClient.postCommentToIssue(
            payload.issue.number,
            classification,
            correlationId
          );
          commentPosted = true;
        } catch (error) {
          log.warn('Failed to post comment, continuing with triage', {
            correlationId,
            issueNumber: payload.issue.number
          });
        }
      }

      const result: TriageResult = {
        success: true,
        classification,
        labelsApplied,
        commentPosted
      };

      triageLog.triageCompleted(payload.issue.number, true, correlationId);

      log.info('Issue triage completed successfully', {
        correlationId,
        issueNumber: payload.issue.number,
        primaryLabel: classification.primaryLabel,
        confidence: classification.confidence,
        labelsApplied,
        commentPosted,
        component: 'triage-orchestrator'
      });

      return result;

    } catch (error) {
      if (error instanceof Error) {
        triageLog.triageError(payload.issue.number, error, correlationId);
      }

      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  // Health check for all services
  public async healthCheck(correlationId: string): Promise<{
    overall: boolean;
    services: {
      classifier: boolean;
      github: boolean;
    };
  }> {
    const [classifierHealthy, githubHealthy] = await Promise.all([
      this.classifier.healthCheck(correlationId).catch(() => false),
      this.githubClient.healthCheck(correlationId).catch(() => false)
    ]);

    const overall = classifierHealthy && githubHealthy;

    log.info('Health check completed', {
      correlationId,
      overall,
      classifier: classifierHealthy,
      github: githubHealthy,
      component: 'triage-orchestrator'
    });

    return {
      overall,
      services: {
        classifier: classifierHealthy,
        github: githubHealthy
      }
    };
  }
}

export default TriageOrchestrator;