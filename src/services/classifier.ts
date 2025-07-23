import { config } from '../config/index.js';
import { log, triageLog, performanceLog } from '../utils/logger.js';
import { 
  OpenAIApiError, 
  OpenAIRateLimitError, 
  OpenAIAuthError,
  ClassificationError,
  LowConfidenceError,
  TimeoutError 
} from '../utils/errors.js';
import type { 
  ClassificationResult, 
  TriageContext, 
  LogContext 
} from '../types/index.js';

// OpenAI API request/response types
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

interface OpenAIRequest {
  model: string;
  messages: OpenAIMessage[];
  temperature: number;
  max_tokens: number;
  response_format: { type: 'json_object' };
}

interface OpenAIResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: 'assistant';
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface ClassificationResponse {
  primaryLabel: string;
  confidence: number;
  reasoning: string;
  additionalLabels?: string[];
  severity?: 'critical' | 'high' | 'medium' | 'low';
}

export class OpenAIClassifier {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly baseUrl = 'https://api.openai.com/v1';
  private readonly timeout = 30000; // 30 second timeout

  constructor() {
    this.apiKey = config.openai.apiKey;
    this.model = config.openai.model;
  }

  // Generate the classification prompt
  private generatePrompt(context: TriageContext): string {
    const availableLabels = config.triage.labels.join(', ');
    
    return `You are an expert GitHub issue triager. Analyze the following issue and classify it accurately.

ISSUE CONTEXT:
Title: "${context.title}"
Body: """${context.body}"""
Author: ${context.author}
Repository: ${context.repository}
Existing Labels: ${context.existingLabels.join(', ') || 'None'}
Created: ${context.createdAt}

AVAILABLE LABELS: ${availableLabels}

CLASSIFICATION RULES:
1. Choose the MOST APPROPRIATE single label from the available labels
2. Provide a confidence score between 0.0 and 1.0
3. Give clear reasoning for your classification
4. Optionally suggest additional labels if relevant
5. Assess severity if it's a bug (critical/high/medium/low)

RESPONSE FORMAT:
Respond with valid JSON matching this exact structure:
{
  "primaryLabel": "string (must be one of the available labels)",
  "confidence": number (0.0 to 1.0),
  "reasoning": "string (2-3 sentences explaining the classification)",
  "additionalLabels": ["string"] (optional array of additional relevant labels),
  "severity": "string" (optional: critical/high/medium/low for bugs)
}

EXAMPLES:
- Bug reports should be labeled "bug" with severity assessment
- Feature requests should be labeled "feature-request"
- Documentation issues should be labeled "documentation"
- General questions should be labeled "question"
- Improvements to existing features should be labeled "enhancement"

Analyze the issue and provide your classification:`;
  }

  // Make HTTP request to OpenAI API
  private async makeRequest(payload: OpenAIRequest, correlationId: string): Promise<OpenAIResponse> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          'User-Agent': 'github-triage-agent/1.0.0'
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleApiError(response, correlationId);
      }

      const result = await response.json() as OpenAIResponse;
      
      log.debug('OpenAI API request successful', {
        correlationId,
        model: result.model,
        tokensUsed: result.usage.total_tokens,
        component: 'openai-classifier'
      });

      return result;

    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new TimeoutError('OpenAI API request', this.timeout, { correlationId });
      }

      if (error instanceof Error) {
        throw new OpenAIApiError(`Request failed: ${error.message}`, undefined, { correlationId });
      }

      throw new OpenAIApiError('Unknown request error', undefined, { correlationId });
    }
  }

  // Handle OpenAI API errors
  private async handleApiError(response: Response, correlationId: string): Promise<never> {
    let errorData: any;
    
    try {
      errorData = await response.json();
    } catch {
      errorData = { error: { message: 'Unknown error' } };
    }

    const context: LogContext = { correlationId };
    const errorMessage = errorData.error?.message || 'Unknown API error';

    switch (response.status) {
      case 401:
        throw new OpenAIAuthError(`Authentication failed: ${errorMessage}`, context);
      
      case 429:
        const retryAfter = response.headers.get('retry-after');
        const retryAfterSeconds = retryAfter ? parseInt(retryAfter, 10) : undefined;
        throw new OpenAIRateLimitError(
          `Rate limit exceeded: ${errorMessage}`,
          retryAfterSeconds,
          context
        );
      
      case 400:
        throw new OpenAIApiError(`Bad request: ${errorMessage}`, response.status, context);
      
      case 500:
      case 502:
      case 503:
      case 504:
        throw new OpenAIApiError(`Server error: ${errorMessage}`, response.status, context);
      
      default:
        throw new OpenAIApiError(`API error: ${errorMessage}`, response.status, context);
    }
  }

  // Parse and validate OpenAI response
  private parseClassificationResponse(content: string, correlationId: string): ClassificationResponse {
    try {
      const parsed = JSON.parse(content) as ClassificationResponse;
      
      // Validate required fields
      if (!parsed.primaryLabel || typeof parsed.confidence !== 'number') {
        throw new Error('Missing required fields');
      }

      // Validate confidence range
      if (parsed.confidence < 0 || parsed.confidence > 1) {
        throw new Error('Confidence must be between 0 and 1');
      }

      // Validate primary label is in available labels
      if (!config.triage.labels.includes(parsed.primaryLabel)) {
        log.warn('OpenAI returned invalid label, using fallback', {
          correlationId,
          invalidLabel: parsed.primaryLabel,
          availableLabels: config.triage.labels,
          component: 'openai-classifier'
        });
        
        // Use first available label as fallback
        parsed.primaryLabel = config.triage.labels[0];
        parsed.confidence = Math.min(parsed.confidence, 0.5); // Reduce confidence for fallback
      }

      return parsed;

    } catch (error) {
      throw new ClassificationError(
        `Failed to parse OpenAI response: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { correlationId }
      );
    }
  }

  // Main classification method
  public async classifyIssue(context: TriageContext, correlationId: string): Promise<ClassificationResult> {
    const timer = performanceLog.startTimer('issue-classification', correlationId);
    
    try {
      triageLog.classificationStarted(
        parseInt(context.repository.split('/')[1]) || 0, // Extract issue number from context if available
        correlationId
      );

      const prompt = this.generatePrompt(context);
      
      const payload: OpenAIRequest = {
        model: this.model,
        messages: [
          {
            role: 'system',
            content: 'You are an expert GitHub issue triager. Always respond with valid JSON.'
          },
          {
            role: 'user',
            content: prompt
          }
        ],
        temperature: 0.3, // Lower temperature for more consistent classifications
        max_tokens: 500,
        response_format: { type: 'json_object' }
      };

      log.debug('Making OpenAI classification request', {
        correlationId,
        model: this.model,
        titleLength: context.title.length,
        bodyLength: context.body.length,
        component: 'openai-classifier'
      });

      const response = await this.makeRequest(payload, correlationId);
      
      if (!response.choices || response.choices.length === 0) {
        throw new ClassificationError('No classification choices returned', { correlationId });
      }

      const choice = response.choices[0];
      if (choice.finish_reason !== 'stop') {
        log.warn('OpenAI response may be incomplete', {
          correlationId,
          finishReason: choice.finish_reason,
          component: 'openai-classifier'
        });
      }

      const classification = this.parseClassificationResponse(choice.message.content, correlationId);
      
      const result: ClassificationResult = {
        primaryLabel: classification.primaryLabel,
        confidence: classification.confidence,
        reasoning: classification.reasoning,
        additionalLabels: classification.additionalLabels,
        severity: classification.severity
      };

      // Check confidence threshold
      if (result.confidence < config.triage.confidenceThreshold) {
        log.warn('Classification confidence below threshold', {
          correlationId,
          confidence: result.confidence,
          threshold: config.triage.confidenceThreshold,
          primaryLabel: result.primaryLabel,
          component: 'openai-classifier'
        });
        
        throw new LowConfidenceError(
          result.confidence,
          config.triage.confidenceThreshold,
          { correlationId }
        );
      }

      triageLog.classificationCompleted(
        parseInt(context.repository.split('/')[1]) || 0,
        result.primaryLabel,
        result.confidence,
        correlationId
      );

      const duration = timer.end();
      
      log.info('Issue classification successful', {
        correlationId,
        primaryLabel: result.primaryLabel,
        confidence: result.confidence,
        duration,
        tokensUsed: response.usage.total_tokens,
        component: 'openai-classifier'
      });

      return result;

    } catch (error) {
      timer.end();
      
      // Re-throw our custom errors
      if (error instanceof OpenAIApiError || 
          error instanceof OpenAIRateLimitError || 
          error instanceof OpenAIAuthError ||
          error instanceof ClassificationError ||
          error instanceof LowConfidenceError ||
          error instanceof TimeoutError) {
        throw error;
      }

      // Wrap unexpected errors
      throw new ClassificationError(
        `Unexpected classification error: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { correlationId }
      );
    }
  }

  // Health check method
  public async healthCheck(correlationId: string): Promise<boolean> {
    try {
      const testContext: TriageContext = {
        title: 'Health check test',
        body: 'This is a test issue for health checking',
        author: 'system',
        repository: 'test/test',
        existingLabels: [],
        createdAt: new Date().toISOString()
      };

      const result = await this.classifyIssue(testContext, correlationId);
      return result.confidence > 0;

    } catch (error) {
      log.error('OpenAI classifier health check failed', { correlationId }, error as Error);
      return false;
    }
  }
}

export default OpenAIClassifier;