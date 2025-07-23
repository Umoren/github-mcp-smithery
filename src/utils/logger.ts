import winston from 'winston';
import { config } from '../config/index.js';
import type { LogContext } from '../types/index.js';

// Custom log levels
const levels = {
  error: 0,
  warn: 1,
  info: 2,
  debug: 3
};

// Create winston logger instance
const logger = winston.createLogger({
  levels,
  level: config.server.logLevel,
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DD HH:mm:ss'
    }),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'github-triage-agent',
    environment: config.server.environment
  },
  transports: [
    // Console transport with colorized output for development
    new winston.transports.Console({
      format: winston.format.combine(
        winston.format.colorize(),
        winston.format.simple(),
        winston.format.timestamp({
          format: 'HH:mm:ss'
        }),
        winston.format.printf(({ timestamp, level, message, ...meta }) => {
          const metaStr = Object.keys(meta).length > 0 ? 
            ` ${JSON.stringify(meta)}` : '';
          return `${timestamp} [${level}]: ${message}${metaStr}`;
        })
      )
    })
  ]
});

// Add file transport for production
if (config.server.environment === 'production') {
  logger.add(new winston.transports.File({
    filename: 'logs/error.log',
    level: 'error',
    format: winston.format.json()
  }));
  
  logger.add(new winston.transports.File({
    filename: 'logs/combined.log',
    format: winston.format.json()
  }));
}

// Helper function to generate correlation IDs
function generateCorrelationId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// Structured logging functions with context
export const log = {
  error: (message: string, context?: LogContext, error?: Error) => {
    logger.error(message, {
      ...context,
      correlationId: context?.correlationId || generateCorrelationId(),
      ...(error && {
        error: {
          name: error.name,
          message: error.message,
          stack: error.stack
        }
      })
    });
  },

  warn: (message: string, context?: LogContext) => {
    logger.warn(message, {
      ...context,
      correlationId: context?.correlationId || generateCorrelationId()
    });
  },

  info: (message: string, context?: LogContext) => {
    logger.info(message, {
      ...context,
      correlationId: context?.correlationId || generateCorrelationId()
    });
  },

  debug: (message: string, context?: LogContext) => {
    logger.debug(message, {
      ...context,
      correlationId: context?.correlationId || generateCorrelationId()
    });
  }
};

// Specialized logging functions for common operations
export const triageLog = {
  webhookReceived: (issueNumber: number, action: string, correlationId: string) => {
    log.info('GitHub webhook received', {
      correlationId,
      issueNumber,
      action,
      component: 'webhook-handler'
    });
  },

  classificationStarted: (issueNumber: number, correlationId: string) => {
    log.info('Issue classification started', {
      correlationId,
      issueNumber,
      component: 'classifier'
    });
  },

  classificationCompleted: (issueNumber: number, label: string, confidence: number, correlationId: string) => {
    log.info('Issue classification completed', {
      correlationId,
      issueNumber,
      classification: { label, confidence },
      component: 'classifier'
    });
  },

  labelingStarted: (issueNumber: number, labels: string[], correlationId: string) => {
    log.info('Issue labeling started', {
      correlationId,
      issueNumber,
      labels,
      component: 'github-client'
    });
  },

  labelingCompleted: (issueNumber: number, labelsApplied: string[], correlationId: string) => {
    log.info('Issue labeling completed', {
      correlationId,
      issueNumber,
      labelsApplied,
      component: 'github-client'
    });
  },

  commentPosted: (issueNumber: number, correlationId: string) => {
    log.info('Comment posted to issue', {
      correlationId,
      issueNumber,
      component: 'github-client'
    });
  },

  triageCompleted: (issueNumber: number, success: boolean, correlationId: string) => {
    log.info('Issue triage completed', {
      correlationId,
      issueNumber,
      success,
      component: 'triage-orchestrator'
    });
  },

  triageError: (issueNumber: number, error: Error, correlationId: string) => {
    log.error('Issue triage failed', {
      correlationId,
      issueNumber,
      component: 'triage-orchestrator'
    }, error);
  }
};

// Request middleware logger
export const requestLogger = {
  logRequest: (method: string, url: string, correlationId: string) => {
    log.info('HTTP request received', {
      correlationId,
      method,
      url,
      component: 'http-server'
    });
  },

  logResponse: (method: string, url: string, statusCode: number, duration: number, correlationId: string) => {
    log.info('HTTP request completed', {
      correlationId,
      method,
      url,
      statusCode,
      duration,
      component: 'http-server'
    });
  }
};

// Performance logging
export const performanceLog = {
  startTimer: (operation: string, correlationId: string) => {
    const startTime = Date.now();
    log.debug(`${operation} started`, {
      correlationId,
      component: 'performance'
    });
    
    return {
      end: () => {
        const duration = Date.now() - startTime;
        log.debug(`${operation} completed`, {
          correlationId,
          duration,
          component: 'performance'
        });
        return duration;
      }
    };
  }
};

export { generateCorrelationId };
export default logger;