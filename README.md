# GitHub Issue Auto-Triage Agent

A production-ready AI-powered system that automatically classifies and triages GitHub issues using OpenAI's language models and the Model Context Protocol (MCP), orchestrated through Smithery's platform.

## Features

### 🤖 AI-Powered Classification
- **Intelligent Issue Analysis**: Uses OpenAI GPT-4o to classify issues with 85-95% confidence
- **Multi-Category Support**: Automatically categorizes issues as bug, feature-request, documentation, question, or enhancement
- **Confidence Scoring**: Only applies labels when classification confidence exceeds configurable threshold
- **Contextual Reasoning**: Provides clear explanations for classification decisions

### 🏷️ Automated GitHub Operations
- **Smart Labeling**: Automatically applies appropriate labels based on AI classification
- **Helpful Comments**: Posts structured triage comments explaining the classification reasoning
- **Severity Assessment**: Evaluates bug severity levels (critical, high, medium, low)
- **Label Management**: Handles existing labels intelligently to avoid duplicates

### 🛠️ Production-Grade Infrastructure
- **Structured Logging**: Comprehensive logging with correlation IDs for request tracing
- **Error Handling**: Custom error classes with proper context and retry logic
- **Input Validation**: Zod-based schema validation for all configurations and inputs
- **Health Monitoring**: Built-in health checks for all integrated services

### ⚡ MCP Integration
- **Smithery Orchestration**: Seamless integration with GitHub and OpenAI through MCP servers
- **Real-time Processing**: Fast classification and labeling (typically under 5 seconds)
- **Tool-based Interface**: Four core MCP tools for different operational needs
- **Zero Infrastructure**: Leverages Smithery's managed platform for deployment

## Architecture

```
MCP Client → Smithery Platform → GitHub Auto-Triage Agent
                                         ↓
                               OpenAI MCP ← → GitHub MCP
```

The system uses the Model Context Protocol to orchestrate between:
- **GitHub MCP Server**: Handles repository operations (issue creation, labeling, commenting)
- **OpenAI MCP Server**: Manages AI classification requests
- **Smithery Platform**: Provides unified orchestration and management

## Quick Start

### Prerequisites
- Node.js 18+
- GitHub Personal Access Token with `repo` scope
- OpenAI API key
- Smithery account ([sign up free](https://smithery.ai/signup))

### Installation

1. **Clone and install dependencies**:
   ```bash
   git clone <repository-url>
   cd github-issue-triage-agent
   npm install
   ```

2. **Configure environment variables**:
   ```bash
   cp .env.example .env
   ```
   
   Edit `.env` with your credentials:
   ```bash
   GITHUB_TOKEN=ghp_your_github_token
   GITHUB_WEBHOOK_SECRET=your_webhook_secret
   OPENAI_API_KEY=sk-proj-your_openai_key
   GITHUB_REPO_OWNER=your_username
   GITHUB_REPO_NAME=your_repository
   ```

3. **Start the development server**:
   ```bash
   npm run dev
   ```

4. **Access the Smithery playground** at the provided URL to test the MCP tools.

### Repository Setup

Ensure your target GitHub repository has these labels:
- `bug` - Something isn't working
- `feature-request` - New feature or request  
- `documentation` - Improvements or additions to documentation
- `question` - Further information is requested
- `enhancement` - New feature or request

## MCP Tools

The agent exposes four MCP tools for different operational needs:

### `triage_issue`
Manually classify an existing issue without modifying GitHub.

**Parameters:**
- `issueNumber` (number): GitHub issue number
- `title` (string): Issue title
- `body` (string): Issue description
- `author` (string): Issue author username

**Use case:** Test classification logic or manually triage specific issues.

### `create_and_triage_issue`
Create a new GitHub issue and immediately classify it with full automation.

**Parameters:**
- `title` (string): Issue title
- `body` (string): Issue description  
- `issueType` (optional): Expected classification for validation

**Use case:** End-to-end automation - creates issue, classifies, labels, and comments.

### `health_check`
Verify connectivity and health of all integrated services.

**Returns:** Status of OpenAI and GitHub API connections.

**Use case:** System monitoring and troubleshooting.

### `get_config`
Retrieve current agent configuration and settings.

**Returns:** Current triage settings, repository info, and server configuration.

**Use case:** Configuration verification and debugging.

## Configuration

### Environment Variables

| Variable | Description | Required |
|----------|-------------|----------|
| `GITHUB_TOKEN` | GitHub PAT with `repo` scope | Yes |
| `GITHUB_WEBHOOK_SECRET` | Webhook verification secret | Yes |  
| `OPENAI_API_KEY` | OpenAI API key | Yes |
| `GITHUB_REPO_OWNER` | Target repository owner | Yes |
| `GITHUB_REPO_NAME` | Target repository name | Yes |
| `OPENAI_MODEL` | OpenAI model (default: gpt-4o) | No |
| `CONFIDENCE_THRESHOLD` | Min confidence for auto-labeling (default: 0.75) | No |
| `AUTO_COMMENT` | Enable auto-commenting (default: true) | No |
| `LOG_LEVEL` | Logging level (default: info) | No |

### Classification Labels

Default supported labels (configurable via `TRIAGE_LABELS`):
- `bug` - Issues reporting problems or errors
- `feature-request` - Requests for new functionality  
- `documentation` - Documentation improvements or clarifications
- `question` - User questions or help requests
- `enhancement` - Improvements to existing features

## Usage Examples

### Basic Issue Classification

```typescript
// Through MCP client
const result = await client.callTool("triage_issue", {
  issueNumber: 42,
  title: "App crashes on login",
  body: "When I click login, the app freezes and shows a JavaScript error",
  author: "user123"
});
```

### Create and Auto-Triage

```typescript
// Creates issue #43 and immediately triages it
const result = await client.callTool("create_and_triage_issue", {
  title: "Add dark mode support", 
  body: "Users have requested a dark theme option for better night-time usage",
  issueType: "feature" // optional validation
});
```

### System Health Check

```typescript
const health = await client.callTool("health_check", {});
// Returns: { overall: true, services: { classifier: true, github: true } }
```

## Production Deployment

### Smithery Platform

1. **Push code to GitHub**
2. **Connect repository** in Smithery dashboard
3. **Configure environment variables** in deployment settings
4. **Deploy** from Smithery interface

### Environment Configuration

For production deployments:
- Set `NODE_ENV=production`
- Use `LOG_LEVEL=info` or `warn`
- Ensure all required environment variables are configured
- Verify GitHub token has appropriate repository permissions

## Monitoring and Observability

### Structured Logging

All operations include structured logging with:
- **Correlation IDs**: Track requests across services
- **Component Tags**: Identify log sources
- **Performance Metrics**: Duration and token usage tracking
- **Error Context**: Detailed error information with stack traces

### Health Monitoring

Built-in health checks verify:
- OpenAI API connectivity and authentication
- GitHub API access and repository permissions
- Configuration validity
- Service response times

### Metrics Collection

The system tracks:
- Classification accuracy and confidence scores
- Processing times for each operation
- API usage and rate limiting
- Error rates and failure patterns

## Troubleshooting

### Common Issues

**Classification Confidence Too Low**
- Adjust `CONFIDENCE_THRESHOLD` in configuration
- Review issue content quality and completeness
- Check OpenAI API model performance

**GitHub API Errors**
- Verify token has `repo` scope
- Check repository permissions
- Ensure target repository exists and is accessible

**OpenAI API Issues**
- Validate API key format and permissions
- Monitor rate limits and usage quotas
- Check model availability

### Debug Mode

Enable debug logging with `LOG_LEVEL=debug` to see:
- Detailed API request/response data
- Classification reasoning and confidence scores
- Internal state transitions
- Performance timing information

## API Rate Limits

### GitHub API
- 5,000 requests/hour with Personal Access Token
- Automatic retry with exponential backoff on rate limit errors
- Rate limit status monitoring and logging

### OpenAI API  
- Varies by subscription tier
- Automatic error handling for rate limit responses
- Token usage tracking and optimization

## Security Considerations

### API Keys
- Store all credentials in environment variables
- Never commit secrets to version control
- Rotate keys regularly
- Use least-privilege access principles

### Input Validation
- All inputs validated with Zod schemas
- HTML sanitization for issue content
- Protection against injection attacks
- Webhook signature verification

## Contributing

### Development Setup

1. Fork the repository
2. Create a feature branch
3. Install dependencies: `npm install`
4. Start development: `npm run dev`
5. Run tests: `npm test`
6. Submit pull request

### Code Standards

- TypeScript strict mode enabled
- Comprehensive error handling required
- Structured logging for all operations
- Unit tests for business logic
- Production-grade code quality

## License

MIT License - see LICENSE file for details.

## Support

For issues and support:
- GitHub Issues: Create issues in this repository
- Smithery Support: [Contact Smithery](https://smithery.ai/support)
- Documentation: [Smithery Docs](https://smithery.ai/docs)

---

Built with ❤️ using [Smithery](https://smithery.ai) and the Model Context Protocol.