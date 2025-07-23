import type { LogContext } from '../types/index.js';

// Base error class for all application errors
export abstract class AppError extends Error {
  abstract readonly statusCode: number;
  abstract readonly code: string;
  abstract readonly retryable: boolean;
  
  public readonly context?: LogContext;
  public readonly timestamp: string;

  constructor(message: string, context?: LogContext) {
    super(message);
    this.name = this.constructor.name;
    this.context = context;
    this.timestamp = new Date().toISOString();
    
    // Maintain proper stack trace
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  // Serialize error for logging
  toJSON() {
    return {
      name: this.name,
      message: this.message,
      code: this.code,
      statusCode: this.statusCode,
      retryable: this.retryable,
      context: this.context,
      timestamp: this.timestamp,
      stack: this.stack
    };
  }
}

// GitHub API related errors
export class GitHubApiError extends AppError {
  readonly statusCode = 502;
  readonly code = 'GITHUB_API_ERROR';
  readonly retryable = true;

  constructor(message: string, public readonly apiStatusCode?: number, context?: LogContext) {
    super(`GitHub API Error: ${message}`, context);
  }
}

export class GitHubAuthError extends AppError {
  readonly statusCode = 401;
  readonly code = 'GITHUB_AUTH_ERROR';
  readonly retryable = false;

  constructor(message: string = 'GitHub authentication failed', context?: LogContext) {
    super(message, context);
  }
}

export class GitHubRateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'GITHUB_RATE_LIMIT';
  readonly retryable = true;

  constructor(
    message: string = 'GitHub API rate limit exceeded', 
    public readonly resetTime?: number,
    context?: LogContext
  ) {
    super(message, context);
  }
}

// OpenAI API related errors
export class OpenAIApiError extends AppError {
  readonly statusCode = 502;
  readonly code = 'OPENAI_API_ERROR';
  readonly retryable = true;

  constructor(message: string, public readonly apiStatusCode?: number, context?: LogContext) {
    super(`OpenAI API Error: ${message}`, context);
  }
}

export class OpenAIRateLimitError extends AppError {
  readonly statusCode = 429;
  readonly code = 'OPENAI_RATE_LIMIT';
  readonly retryable = true;

  constructor(
    message: string = 'OpenAI API rate limit exceeded',
    public readonly retryAfter?: number,
    context?: LogContext
  ) {
    super(message, context);
  }
}

export class OpenAIAuthError extends AppError {
  readonly statusCode = 401;
  readonly code = 'OPENAI_AUTH_ERROR';
  readonly retryable = false;

  constructor(message: string = 'OpenAI authentication failed', context?: LogContext) {
    super(message, context);
  }
}

// Classification related errors
export class ClassificationError extends AppError {
  readonly statusCode = 500;
  readonly code = 'CLASSIFICATION_ERROR';
  readonly retryable = true;

  constructor(message: string, context?: LogContext) {
    super(`Classification Error: ${message}`, context);
  }
}

export class LowConfidenceError extends AppError {
  readonly statusCode = 200; // Not really an error, more of a warning
  readonly code = 'LOW_CONFIDENCE';
  readonly retryable = false;

  constructor(
    public readonly confidence: number,
    public readonly threshold: number,
    context?: LogContext
  ) {
    super(`Classification confidence ${confidence} below threshold ${threshold}`, context);
  }
}

// Webhook related errors
export class WebhookVerificationError extends AppError {
  readonly statusCode = 401;
  readonly code = 'WEBHOOK_VERIFICATION_FAILED';
  readonly retryable = false;

  constructor(message: string = 'Webhook signature verification failed', context?: LogContext) {
    super(message, context);
  }
}

export class WebhookPayloadError extends AppError {
  readonly statusCode = 400;
  readonly code = 'WEBHOOK_PAYLOAD_INVALID';
  readonly retryable = false;

  constructor(message: string, context?: LogContext) {
    super(`Invalid webhook payload: ${message}`, context);
  }
}

// Configuration related errors
export class ConfigurationError extends AppError {
  readonly statusCode = 500;
  readonly code = 'CONFIGURATION_ERROR';
  readonly retryable = false;

  constructor(message: string, context?: LogContext) {
    super(`Configuration Error: ${message}`, context);
  }
}

// Network and timeout errors
export class TimeoutError extends AppError {
  readonly statusCode = 504;
  readonly code = 'TIMEOUT_ERROR';
  readonly retryable = true;

  constructor(
    operation: string,
    public readonly timeoutMs: number,
    context?: LogContext
  ) {
    super(`Operation '${operation}' timed out after ${timeoutMs}ms`, context);
  }
}

export class NetworkError extends AppError {
  readonly statusCode = 502;
  readonly code = 'NETWORK_ERROR';
  readonly retryable = true;

  constructor(message: string, context?: LogContext) {
    super(`Network Error: ${message}`, context);
  }
}

// Validation errors
export class ValidationError extends AppError {
  readonly statusCode = 400;
  readonly code = 'VALIDATION_ERROR';
  readonly retryable = false;

  constructor(message: string, public readonly field?: string, context?: LogContext) {
    super(`Validation Error: ${message}`, context);
  }
}

// Circuit breaker error
export class CircuitBreakerError extends AppError {
  readonly statusCode = 503;
  readonly code = 'CIRCUIT_BREAKER_OPEN';
  readonly retryable = true;

  constructor(service: string, context?: LogContext) {
    super(`Circuit breaker is open for service: ${service}`, context);
  }
}

// Helper function to determine if an error is retryable
export function isRetryableError(error: Error): boolean {
  if (error instanceof AppError) {
    return error.retryable;
  }
  
  // Consider unknown errors as potentially retryable
  return true;
}

// Helper function to extract HTTP status code from error
export function getHttpStatusCode(error: Error): number {
  if (error instanceof AppError) {
    return error.statusCode;
  }
  
  // Default to 500 for unknown errors
  return 500;
}

// Helper function to create error response for HTTP APIs
export function createErrorResponse(error: Error) {
  const statusCode = getHttpStatusCode(error);
  const isAppError = error instanceof AppError;
  
  return {
    statusCode,
    body: {
      error: {
        name: error.name,
        message: error.message,
        code: isAppError ? error.code : 'INTERNAL_ERROR',
        retryable: isAppError ? error.retryable : true,
        timestamp: isAppError ? error.timestamp : new Date().toISOString()
      }
    }
  };
}

// Error factory functions for common scenarios
export const ErrorFactory = {
  githubApiError: (message: string, statusCode?: number, context?: LogContext) =>
    new GitHubApiError(message, statusCode, context),
    
  openaiApiError: (message: string, statusCode?: number, context?: LogContext) =>
    new OpenAIApiError(message, statusCode, context),
    
  webhookVerificationFailed: (context?: LogContext) =>
    new WebhookVerificationError(undefined, context),
    
  classificationFailed: (message: string, context?: LogContext) =>
    new ClassificationError(message, context),
    
  lowConfidence: (confidence: number, threshold: number, context?: LogContext) =>
    new LowConfidenceError(confidence, threshold, context),
    
  timeout: (operation: string, timeoutMs: number, context?: LogContext) =>
    new TimeoutError(operation, timeoutMs, context),
    
  validation: (message: string, field?: string, context?: LogContext) =>
    new ValidationError(message, field, context)
};