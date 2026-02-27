# Enterprise OpenAI Configuration Guide

This guide explains how to configure the AI Summary feature to use your enterprise OpenAI account, ensuring your confidential data remains within your organization's account.

## Why This Matters

When you use an enterprise OpenAI account:
- Your data is processed under your organization's data processing agreement
- Usage is tracked under your organization's account
- Enhanced privacy and security controls apply
- Data retention policies follow your enterprise agreement

## Configuration Steps

### 1. Get Your Enterprise API Key

1. Log into your organization's OpenAI account at https://platform.openai.com
2. Navigate to API Keys section
3. Create a new API key (or use an existing one)
4. **Important**: Ensure this key is associated with your enterprise account, not a personal account

### 2. Get Your Organization ID and Project ID (if required)

**Organization ID**: If you belong to multiple organizations or need to specify which organization to use:
1. In your OpenAI dashboard, check your organization settings
2. Copy your Organization ID (format: `org-xxxxxxxxxxxxx`)
3. Usage from API requests will count toward the specified organization

**Project ID**: For project-based billing and tracking:
1. In your OpenAI dashboard, navigate to your project settings
2. Copy your Project ID (format: `proj-xxxxxxxxxxxxx`)
3. Usage from API requests will count toward the specified project

**Note**: According to OpenAI's authentication documentation, if you access projects through a legacy user API key, you should pass both headers to specify which organization and project to use.

### 3. Configure Environment Variables

Create a `.env.local` file in the project root (this file is already in `.gitignore` and won't be committed):

```bash
# Required: Your enterprise OpenAI API key
# API keys should be securely loaded from environment variables (never in client-side code)
# Remember: Your API key is a secret! Do not share it or expose it in browsers/apps
OPENAI_API_KEY=sk-your-enterprise-api-key-here

# Optional: If your enterprise uses a custom API endpoint
# (Most enterprise accounts use the standard endpoint, so you can omit this)
OPENAI_API_BASE_URL=https://api.openai.com/v1

# Optional: Organization ID (for multi-org accounts or legacy user API keys)
# Usage counts toward the specified organization
# Format: org-xxxxxxxxxxxxx
OPENAI_ORGANIZATION_ID=org-xxxxxxxxxxxxx

# Optional: Project ID (for project-based billing/tracking)
# Usage counts toward the specified project
# Format: proj-xxxxxxxxxxxxx
OPENAI_PROJECT_ID=proj-xxxxxxxxxxxxx

# Optional: Override the default model
# Default is gpt-4o-mini, but you can use gpt-4, gpt-4-turbo, etc.
OPENAI_MODEL=gpt-4o-mini
```

### 4. Verify Your Configuration

To verify you're using the enterprise account:

1. **Check the API key prefix**: Enterprise API keys typically start with `sk-` and are longer
2. **Test the connection**: Try generating a summary and check for any errors
3. **Verify in OpenAI dashboard**: After generating a summary, check your OpenAI usage dashboard to confirm the request appears under your enterprise account

### 5. Restart the Development Server

After setting environment variables, restart your development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart:
npm run dev
```

## Production Deployment

For production deployments (e.g., Vercel, AWS, etc.):

1. **Set environment variables in your hosting platform**:
   - Never commit API keys to git
   - Use your platform's environment variable settings
   - Set the same variables: `OPENAI_API_KEY`, `OPENAI_ORGANIZATION_ID` (if needed), etc.

2. **Verify the deployment**:
   - Check that environment variables are set correctly
   - Test the summary generation in production
   - Monitor your OpenAI dashboard to confirm requests are going to your enterprise account

## Security Best Practices (Following OpenAI Guidelines)

Following OpenAI's authentication best practices:

1. **API keys are secrets**: Your API key is a secret! Do not share it with others or expose it in any client-side code (browsers, apps)
2. **Server-side only**: API keys should be securely loaded from an environment variable or key management service on the server (✅ This implementation does this correctly)
3. **Never commit API keys**: The `.env.local` file is already in `.gitignore` and won't be committed to git
4. **Use Bearer authentication**: API keys are provided via HTTP Bearer authentication (✅ This implementation uses `Authorization: Bearer ${apiKey}`)
5. **Rotate keys regularly**: Update your API keys periodically
6. **Use separate keys for dev/prod**: Different API keys for development and production environments
7. **Monitor usage**: Regularly check your OpenAI dashboard for unexpected usage
8. **Restrict key permissions**: If possible, restrict API key permissions to only what's needed

## Troubleshooting

### "OpenAI API key not configured"
- Ensure `.env.local` exists in the project root
- Verify `OPENAI_API_KEY` is set correctly
- Restart the development server after adding environment variables

### "Invalid API key" or "Unauthorized"
- Verify the API key is correct and active
- Check if the key is associated with your enterprise account
- Ensure you haven't exceeded rate limits or quotas

### "Organization not found" or "Project not found"
- Verify `OPENAI_ORGANIZATION_ID` is correct (if using)
- Verify `OPENAI_PROJECT_ID` is correct (if using)
- Some accounts don't require these headers - try removing them if you get errors
- If you're using a legacy user API key, you may need both organization and project headers

### Data Privacy Concerns
- All API calls go through your configured endpoint
- The API key determines which account processes the data
- Enterprise accounts have enhanced data processing agreements
- Check your organization's OpenAI agreement for specific privacy guarantees

## How to Verify Data is Going to Your Enterprise Account

1. **Check API key**: The key you use determines the account
2. **Monitor usage dashboard**: After generating summaries, check your OpenAI organization's usage dashboard
3. **Check billing**: Verify charges appear under your enterprise account
4. **Contact OpenAI support**: If unsure, contact your organization's OpenAI administrator

## Alternative: Self-Hosted or On-Premise Solutions

If you need even more control over data privacy:

1. **OpenAI Azure**: Some organizations use Azure OpenAI Service for additional data residency controls
2. **Self-hosted models**: Consider self-hosting open-source LLMs (e.g., Llama 2, Mistral) if data cannot leave your infrastructure
3. **Private API endpoints**: Some enterprise agreements include private API endpoints

For these alternatives, you would need to modify the API route to use different endpoints or models.
