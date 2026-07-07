# 🚀 Deployment Guide - Juria

Complete setup guide for deploying Juria with automated Edge Functions deployment.

## Prerequisites

- Supabase account with active project
- GitHub account with admin access to repository
- Supabase CLI installed locally

## Step 1: Setup Supabase Vault (Secrets)

Store sensitive credentials in Supabase Vault:

```bash
# Login to Supabase
supabase login

# Set your project ID
export SUPABASE_PROJECT_ID="your-project-id"

# Add secrets to Supabase Vault
supabase secrets set OPENAI_API_KEY="sk-your-openai-key" \
  --project-ref $SUPABASE_PROJECT_ID

supabase secrets set SUPABASE_SERVICE_ROLE_KEY="your-service-role-key" \
  --project-ref $SUPABASE_PROJECT_ID
```

Get `SUPABASE_SERVICE_ROLE_KEY` from:
- Supabase Dashboard → Project Settings → API
- Look for "Service role" key

## Step 2: Setup GitHub Secrets

Configure GitHub Actions with deployment credentials:

### Option A: Via GitHub Web UI

1. Go to Repository → Settings → Secrets and variables → Actions
2. Click "New repository secret"
3. Add these secrets:

| Secret Name | Value | Where to Get |
|-------------|-------|--------------|
| `SUPABASE_ACCESS_TOKEN` | Authentication token | Step 2B below |
| `SUPABASE_PROJECT_ID` | Your project ID | Supabase Dashboard URL |

### Option B: Via GitHub CLI

```bash
# Get authentication token
supabase login
# Token saved to ~/.supabase/access-token

# Add secrets
gh secret set SUPABASE_ACCESS_TOKEN --body "$(cat ~/.supabase/access-token)"
gh secret set SUPABASE_PROJECT_ID --body "your-project-id"

# Verify
gh secret list
```

### Getting SUPABASE_ACCESS_TOKEN

1. Run: `supabase login`
2. Follow browser prompt to authenticate
3. Token is saved to: `~/.supabase/access-token`
4. Copy it: `cat ~/.supabase/access-token`

### Getting SUPABASE_PROJECT_ID

Dashboard URL: `https://app.supabase.com/project/[PROJECT_ID]/...`

Or via CLI:
```bash
supabase projects list
```

## Step 2.5: Setup Database Schema

Initialize the Supabase database with required tables and policies:

1. Go to Supabase Dashboard → SQL Editor
2. Copy all content from `supabase/schema.sql`
3. Paste and run the SQL
4. This creates:
   - `user_profiles` - User subscription and quota data
   - `documents` - Uploaded documents for RAG
   - `document_chunks` - Document chunks with embeddings
   - `articles_juridiques` - Legal articles database
   - RLS policies for security
   - Auto-creation trigger for new users

Alternatively, run via CLI:
```bash
psql -h [project].supabase.co -U postgres < supabase/schema.sql
# Enter password when prompted
```

## Step 3: Local Development Setup

1. **Copy environment template:**
   ```bash
   cp .env.example .env.local
   ```

2. **Fill in values from Supabase:**
   ```bash
   # Edit .env.local
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=eyJ0eXAi...
   ```

3. **Install dependencies:**
   ```bash
   npm install
   ```

4. **Run development server:**
   ```bash
   npm run dev
   ```

## Step 4: Edge Functions Deployment

### Local Testing

```bash
# Start local Supabase instance
supabase start

# Deploy to local environment
supabase functions deploy smart-endpoint --project-ref local

# Test function locally
curl -X POST http://localhost:54321/functions/v1/smart-endpoint \
  -H "Authorization: Bearer YOUR_JWT_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"operation": "read", "table": "folders", "orgId": "org_123"}'
```

### Automatic Deployment (GitHub Actions)

1. Push to main branch:
   ```bash
   git push origin main
   ```

2. GitHub Actions automatically:
   - Runs on code changes in `supabase/functions/**`
   - Uses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_ID`
   - Deploys smart-endpoint function
   - Verifies deployment

3. Check deployment status:
   - GitHub → Actions tab
   - Or via CLI: `supabase functions list`

### Manual Deployment

```bash
# Deploy to production
./supabase/deploy.sh production

# Verify deployment
supabase functions list --project-ref $SUPABASE_PROJECT_ID

# View logs
supabase functions logs smart-endpoint --project-ref $SUPABASE_PROJECT_ID
```

## Step 5: Database Row-Level Security (RLS)

Edge Functions require RLS policies to enforce organization access:

### Enable RLS on Tables

1. Supabase Dashboard → Authentication → Policies
2. For each table (`folders`, `tasks`, `risks`, `counterparties`, etc):

```sql
-- Enable RLS
ALTER TABLE folders ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their org's records
CREATE POLICY "Users can read own organization folders"
  ON folders FOR SELECT
  USING (organization_id = auth.uid()::text);

-- Policy: Users can update their org's records  
CREATE POLICY "Users can update own organization folders"
  ON folders FOR UPDATE
  USING (organization_id = auth.uid()::text)
  WITH CHECK (organization_id = auth.uid()::text);

-- Policy: Users can delete their org's records
CREATE POLICY "Users can delete own organization folders"
  ON folders FOR DELETE
  USING (organization_id = auth.uid()::text);
```

### Verify RLS is Enabled

```sql
-- Run in Supabase SQL Editor
SELECT schemaname, tablename, rowsecurity
FROM pg_tables
WHERE tablename IN ('folders', 'tasks', 'risks', 'counterparties');
```

Should show: `rowsecurity | true`

## Step 6: Verify Setup

### Test API Connection

```javascript
// In browser console
const response = await fetch(
  'https://your-project.supabase.co/functions/v1/smart-endpoint',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'read',
      table: 'folders',
      filters: {},
      orgId: currentOrgId,
      userId: currentUser.id,
    }),
  }
);

const result = await response.json();
console.log(result); // Should have { success: true, data: [...] }
```

### Deployment Checklist

- [ ] Supabase Vault secrets configured
- [ ] GitHub Secrets added (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID)
- [ ] Database schema initialized (run `supabase/schema.sql`)
- [ ] `.env.local` created and filled
- [ ] Local dev server runs: `npm run dev`
- [ ] Edge Functions deployed: `supabase functions list`
- [ ] RLS enabled on tables (included in schema.sql)
- [ ] User profile auto-creation trigger active
- [ ] API call test succeeds
- [ ] GitHub Actions workflow triggered on push
- [ ] No deployment errors in GitHub Actions

## Monitoring & Logs

### Edge Function Logs

```bash
# View live logs
supabase functions logs smart-endpoint --project-ref $SUPABASE_PROJECT_ID

# Or in Supabase Dashboard
# Project → Edge Functions → smart-endpoint → Logs
```

### GitHub Actions

- GitHub → Repository → Actions tab
- Click workflow run to view logs
- Check "Deploy Edge Functions" step

### Error Investigation

| Error | Solution |
|-------|----------|
| "SUPABASE_ACCESS_TOKEN invalid" | Run `supabase login` and re-add token |
| "Project not found" | Verify SUPABASE_PROJECT_ID is correct |
| "Function deployment failed" | Check function syntax in `supabase/functions/smart-endpoint/index.ts` |
| "401 Unauthorized" | JWT token expired, refresh session |
| "403 Forbidden" | Organization access denied, verify orgId |

## Security Best Practices

✅ **Do:**
- Store all secrets in Supabase Vault
- Use GitHub Secrets for CI/CD tokens
- Never commit `.env.local`
- Rotate credentials every 90 days
- Enable RLS on all tables
- Use organization_id for data isolation

❌ **Don't:**
- Commit `.env.local` or secrets file
- Use hardcoded credentials in code
- Share SUPABASE_ACCESS_TOKEN publicly
- Disable RLS in production
- Use SERVICE_ROLE_KEY on frontend

## Production Deployment

1. **Staging Environment:**
   ```bash
   git push origin staging
   # Automatic deployment to staging
   ```

2. **Production Deployment:**
   ```bash
   git push origin main
   # Automatic deployment to production
   ```

3. **Rollback:**
   ```bash
   # Revert commit
   git revert <commit-hash>
   git push origin main
   # Previous version automatically deployed
   ```

## Support

For issues:
1. Check GitHub Actions logs
2. Review Supabase Edge Function logs
3. Verify GitHub Secrets are set
4. Check Supabase Vault secrets
5. Review RLS policies in database

See `/home/user/Juria/supabase/functions/README.md` for function documentation.
