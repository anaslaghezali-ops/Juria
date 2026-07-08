# 🔐 Secrets Management Guide - Juria

This document describes how to securely manage credentials in the Juria application.

## Overview

```
┌─────────────────┐
│   Development   │  .env.local (never commit)
├─────────────────┤
│    Staging      │  Environment variables
├─────────────────┤
│  Production     │  Supabase Vault + GitHub Secrets
└─────────────────┘
```

## Architecture

### Frontend (Client-Side)
- ❌ NO hardcoded credentials
- ✅ Only public Supabase ANON_KEY (needed for auth)
- ✅ Credentials injected at build time via environment variables

### Edge Functions (Server-Side)
- ✅ Uses SERVICE_ROLE_KEY from Supabase Vault
- ✅ Can access any secret securely
- ✅ Never exposed to frontend

### GitHub Actions (CI/CD)
- ✅ Uses GitHub Secrets for sensitive values
- ✅ Deployed via encrypted environment

---

## Supabase Secrets (Recommended)

### What Goes Here
- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `OPENAI_API_KEY`
- Any third-party API keys

### How to Set

1. **Via Supabase Dashboard:**
   - Go to Project Settings → Secrets
   - Click "New Secret"
   - Name: `OPENAI_API_KEY`, Value: `sk-...`
   - Save

2. **Via Supabase CLI:**
   ```bash
   supabase secrets set OPENAI_API_KEY="sk-..."
   supabase secrets set SERVICE_ROLE_KEY="eyJ..."
   ```

3. **Access in Edge Functions:**
   ```typescript
   const apiKey = Deno.env.get("OPENAI_API_KEY");
   const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
   ```

### Current Secrets

Set these in Supabase Vault:

```
SUPABASE_URL=https://dnrudcpaqcqyybpbbrum.supabase.co
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
OPENAI_API_KEY=sk-your-api-key
```

---

## GitHub Secrets (For CI/CD)

### What Goes Here
- `SUPABASE_ACCESS_TOKEN` (for CLI authentication)
- `SUPABASE_PROJECT_ID` (your project ID)
- Any other CI/CD-specific credentials

### How to Set

1. **Via GitHub Web UI:**
   - Go to Repository → Settings → Secrets and variables → Actions
   - Click "New repository secret"
   - Add each secret

2. **Required Secrets for Deployment:**
   ```
   SUPABASE_ACCESS_TOKEN    → From: supabase login
   SUPABASE_PROJECT_ID      → From: Supabase dashboard
   ```

3. **How to Get Values:**

   **SUPABASE_ACCESS_TOKEN:**
   ```bash
   supabase login
   # Follow the browser prompt
   # Token is stored in ~/.supabase/access-token
   cat ~/.supabase/access-token
   ```

   **SUPABASE_PROJECT_ID:**
   - Visit your Supabase Dashboard
   - URL: https://app.supabase.com/project/<project-id>
   - Or via CLI: `supabase projects list`

### Add to GitHub

```bash
# From terminal with gh CLI
gh secret set SUPABASE_ACCESS_TOKEN --body "$(cat ~/.supabase/access-token)"
gh secret set SUPABASE_PROJECT_ID --body "your-project-id"
```

---

## Local Development (.env.local)

### File: `.env.local` (Never commit!)

```bash
# Supabase
VITE_SUPABASE_URL=https://dnrudcpaqcqyybpbbrum.supabase.co
VITE_SUPABASE_ANON_KEY=eyJ0eXAiOiJKV1QiLCJhbGc...

# API Keys (optional for local dev)
VITE_OPENAI_API_KEY=sk-...
```

### Usage

1. **Create `.env.local`:**
   ```bash
   cp .env.example .env.local
   ```

2. **Fill in values:**
   - `VITE_SUPABASE_URL`: From Supabase dashboard
   - `VITE_SUPABASE_ANON_KEY`: Settings → API

3. **Build with variables:**
   ```bash
   npm run build
   ```

### Rules

- ✅ Gitignored (see `.gitignore`)
- ✅ Can contain secrets safely
- ❌ Never committed to repository
- ❌ Never pushed to GitHub

---

## Environment Variable Injection

### Build-Time (Vite)

Variables prefixed with `VITE_` are available in frontend code:

```javascript
// In config.js
const config = {
  SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
  SUPABASE_ANON_KEY: import.meta.env.VITE_SUPABASE_ANON_KEY,
};
```

### Runtime (Edge Functions)

Environment variables are directly available:

```typescript
// In Edge Functions
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
const openaiKey = Deno.env.get("OPENAI_API_KEY");
```

---

## Deployment Workflow

### 1. Development
```
Developer Machine
    ↓
.env.local (local only)
    ↓
npm run dev
```

### 2. GitHub Actions
```
Git push to main
    ↓
GitHub Actions workflow triggered
    ↓
Use GitHub Secrets (SUPABASE_ACCESS_TOKEN, etc)
    ↓
Deploy Edge Functions
    ↓
Functions use Supabase Vault secrets
```

### 3. Production
```
Deployed Application
    ↓
Frontend: Uses VITE_ variables (injected at build)
    ↓
Edge Functions: Use Supabase Vault secrets
    ↓
Database: RLS enforces authorization
```

---

## Credential Rotation

### Rotating SERVICE_ROLE_KEY

1. **Generate new key in Supabase:**
   - Project Settings → API
   - Click "Reveal" next to Service Role Key
   - Copy full key

2. **Update Supabase Vault:**
   ```bash
   supabase secrets set SUPABASE_SERVICE_ROLE_KEY="new-key-here"
   ```

3. **Update GitHub Secrets:**
   ```bash
   gh secret set SUPABASE_ACCESS_TOKEN --body "new-token"
   ```

4. **Redeploy Edge Functions:**
   ```bash
   ./supabase/deploy.sh production
   ```

### Rotating ANON_KEY

1. In Supabase Dashboard → Settings → API
2. Copy new ANON_KEY
3. Update in:
   - `.env.example`
   - `.env.local` (local only)
   - Rebuild frontend

---

## Security Checklist

- [ ] `.env.local` is in `.gitignore`
- [ ] No secrets in code files
- [ ] No secrets in commit messages
- [ ] Supabase Vault has all required secrets
- [ ] GitHub Secrets configured for CI/CD
- [ ] Edge Functions use `Deno.env.get()`
- [ ] Frontend only uses `VITE_` variables
- [ ] RLS enabled on all tables
- [ ] service role key restricted in Supabase
- [ ] Credentials rotated regularly (every 90 days)

---

## Monitoring & Audit

### Check Active Secrets

```bash
# List Supabase secrets
supabase secrets list --project-ref <project-id>

# List GitHub secrets
gh secret list
```

### View Secret Usage

- **Supabase Dashboard:** Project Settings → Secrets
- **GitHub:** Repository → Settings → Secrets and variables → Actions
- **Code:** Search for `Deno.env.get()` and `import.meta.env`

### Audit Logs

- Supabase: Project Settings → Audit Logs
- GitHub: Repository → Settings → Audit log

---

## Troubleshooting

### "VITE_SUPABASE_URL is undefined"
- Ensure `.env.local` exists with `VITE_SUPABASE_URL=...`
- Rebuild: `npm run build`

### "SUPABASE_SERVICE_ROLE_KEY not found in Edge Function"
- Set secret in Supabase: `supabase secrets set SUPABASE_SERVICE_ROLE_KEY="..."`
- Redeploy function: `./supabase/deploy.sh`

### GitHub Actions deployment fails
- Check GitHub Secrets are set: `gh secret list`
- Verify `SUPABASE_ACCESS_TOKEN` is valid: `supabase projects list`

### "Unauthorized" error in API calls
- Verify JWT token is fresh (not expired)
- Check that user credentials are correct
- Verify Supabase auth is enabled

---

## References

- [Supabase Secrets Docs](https://supabase.com/docs/guides/functions#secrets)
- [GitHub Secrets Docs](https://docs.github.com/en/actions/security-guides/encrypted-secrets)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-modes.html)
- [Deno Permissions](https://docs.deno.com/runtime/manual/basics/permissions)
