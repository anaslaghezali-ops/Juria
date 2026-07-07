# Supabase Edge Functions

Server-side secure operations for Juria application.

## Functions

### `smart-endpoint`

Unified endpoint for protected database operations. All operations enforce organization-level access control.

**Features:**
- JWT authentication
- Organization-level access control
- Automatic organization_id injection
- Support for read, create, update, delete operations
- CORS enabled for frontend calls

**Deployment:**

```bash
# Local deployment (requires Supabase CLI)
./supabase/deploy.sh production

# Or manually:
supabase functions deploy smart-endpoint --project-ref <project-id>
```

**Environment Variables (set in Supabase):**
- `SUPABASE_URL`: Your Supabase project URL
- `SUPABASE_SERVICE_ROLE_KEY`: Service role key for server-side operations

**Request Format:**

```typescript
POST https://<project>.supabase.co/functions/v1/smart-endpoint

Headers:
  Authorization: Bearer <user-jwt-token>
  Content-Type: application/json

Body:
{
  "operation": "read" | "create" | "update" | "delete",
  "table": "folders" | "tasks" | "risks" | "counterparties" | ...,
  "data": { /* for create/update */ },
  "filters": { "id": "...", "name": "..." /* for read/update/delete */ },
  "orgId": "org_123",
  "userId": "user_456"
}
```

**Example - Read Folders:**

```javascript
const response = await fetch(
  'https://project.supabase.co/functions/v1/smart-endpoint',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'read',
      table: 'folders',
      filters: { organization_id: currentOrgId },
      orgId: currentOrgId,
      userId: currentUser.id,
    }),
  }
);

const result = await response.json();
console.log(result.data); // Array of folders
```

**Example - Update Task:**

```javascript
const response = await fetch(
  'https://project.supabase.co/functions/v1/smart-endpoint',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      operation: 'update',
      table: 'tasks',
      filters: { id: 'task_123' },
      data: { title: 'Updated Title', status: 'completed' },
      orgId: currentOrgId,
      userId: currentUser.id,
    }),
  }
);

const result = await response.json();
console.log(result.data); // Updated task records
```

## Security Architecture

### Authentication Flow

```
Frontend (Browser)
      ↓
      ├─→ User logs in via Supabase Auth
      ├─→ Gets JWT access token
      ↓
Edge Function (smart-endpoint)
      ├─→ Validates JWT token
      ├─→ Verifies organization_id matches user's org
      ├─→ Authenticates with Supabase using SERVICE_ROLE_KEY
      ↓
Database (Supabase Postgres)
      ├─→ Row-Level Security (RLS) policies
      ├─→ Enforce organization_id checks
      └─→ Return only authorized data
```

### Data Flow

1. **Frontend**: Sends request with user JWT + organization context
2. **Edge Function**: 
   - Verifies JWT (user is authenticated)
   - Checks organization access (user has permission)
   - Uses SERVICE_ROLE_KEY to access DB
   - Injects organization_id into all filters
3. **Database**: RLS policies validate further at DB level
4. **Response**: Safe data returned to frontend

### Secrets Management

All secrets are stored in **Supabase Vault** (NOT in code):

- `SUPABASE_URL`: Project URL
- `SUPABASE_SERVICE_ROLE_KEY`: For server-side operations

These are automatically available to Edge Functions via environment variables.

## Development

### Local Testing

1. Start local Supabase instance:
```bash
supabase start
```

2. Deploy functions locally:
```bash
supabase functions deploy smart-endpoint --project-ref local
```

3. Call from console:
```javascript
// Get JWT token first
const { data } = await supabase.auth.getSession();
const token = data.session.access_token;

// Call function
const response = await fetch(
  'http://localhost:54321/functions/v1/smart-endpoint',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
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
```

### Production Deployment

1. Set GitHub secrets:
   - `SUPABASE_ACCESS_TOKEN`: From `supabase login`
   - `SUPABASE_PROJECT_ID`: Your project ID

2. Push to main or deployment branch:
```bash
git push origin main
```

3. GitHub Actions automatically deploys the function

4. Verify deployment:
```bash
supabase functions list --project-ref <project-id>
```

## Troubleshooting

### "Unauthorized: Invalid token"
- Ensure JWT token is fresh (not expired)
- Check token is sent in Authorization header as "Bearer <token>"

### "Forbidden: Organization mismatch"
- User's organization doesn't match requested orgId
- Verify user's profile has correct organization_id

### "Database error: permission denied"
- RLS policies not configured correctly
- Verify table has RLS enabled with proper policies

### Function not responding
- Check Supabase dashboard → Functions → Logs
- Verify environment variables are set
- Ensure function is deployed: `supabase functions list`

## Future Enhancements

- [ ] Rate limiting per organization
- [ ] Request logging and audit trails
- [ ] Batch operation support
- [ ] Optimistic locking for concurrent edits
- [ ] Custom business logic per operation type
- [ ] Request validation schema
