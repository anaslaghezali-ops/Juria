# embed-articles - Vector Embedding Generation

Generate OpenAI embeddings for legal articles and store them in Supabase.

## Purpose

This function processes articles from the `articles_juridiques` table that don't have embeddings yet and generates vector embeddings using OpenAI's API. These embeddings enable semantic search capabilities.

## How It Works

1. **Fetch Articles**: Retrieves up to 50 articles without embeddings
2. **Enrich Content**: Combines code, book, title, chapter, numero_article, and content
3. **Generate Embeddings**: Sends text to OpenAI API (model: `text-embedding-3-small`)
4. **Store Vectors**: Saves embeddings back to Supabase
5. **Report Progress**: Returns count of processed articles and remaining articles

## Setup

### Environment Variables (set in Supabase Vault)

```
SUPABASE_URL=https://your-project.supabase.co
SERVICE_ROLE_KEY=eyJ0eXAi...
OPENAI_API_KEY=sk-proj-...
```

### Database Requirements

Table: `articles_juridiques`

```sql
-- Ensure embedding column exists
ALTER TABLE articles_juridiques 
ADD COLUMN IF NOT EXISTS embedding vector(1536);

-- Create index for search (optional)
CREATE INDEX ON articles_juridiques USING ivfflat (embedding vector_cosine_ops)
WITH (lists = 100);
```

## Deployment

```bash
supabase functions deploy embed-articles --project-ref <project-id>
```

## Usage

### Manual Trigger

```bash
# Trigger via curl
curl -X POST https://[project].supabase.co/functions/v1/embed-articles \
  -H "Authorization: Bearer [service_role_key]" \
  -H "Content-Type: application/json"
```

### Scheduled (via cron-job service)

```bash
# Call periodically to generate embeddings for new articles
# Example: Every hour
0 * * * * curl https://[project].supabase.co/functions/v1/embed-articles
```

### From JavaScript

```javascript
const response = await fetch(
  'https://[project].supabase.co/functions/v1/embed-articles',
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
    },
  }
);

const result = await response.json();
console.log(result);
// { 
//   message: "25 embeddings générés",
//   remaining: 150,
//   done: false 
// }
```

## Response Format

### Success (200)

```json
{
  "message": "25 embeddings générés",
  "remaining": 150,
  "done": false
}
```

**Fields:**
- `message`: Number of embeddings generated in this run
- `remaining`: How many articles still need embeddings
- `done`: Whether all articles have been processed

### All Done

```json
{
  "message": "Tous les embeddings sont générés !",
  "total": 0
}
```

### Error (500)

```json
{
  "error": "Error message"
}
```

## Batch Processing

The function processes articles in batches of 50. To generate embeddings for a large collection:

1. Deploy the function
2. Call it once to process 50 articles
3. Repeat until `done: true`

Or use a cron job to call it automatically.

## Performance

- **Batch Size**: 50 articles per call
- **API Calls**: 1 per batch to OpenAI
- **Embedding Model**: `text-embedding-3-small` (1536 dimensions)
- **Cost**: ~0.02 per batch (using small model)

## Monitoring

### Check Function Logs

```bash
supabase functions logs embed-articles --project-ref <project-id>
```

### Monitor Embeddings Progress

```sql
-- Check how many articles have embeddings
SELECT COUNT(*) as with_embeddings
FROM articles_juridiques
WHERE embedding IS NOT NULL;

-- Check how many still need embeddings
SELECT COUNT(*) as without_embeddings
FROM articles_juridiques
WHERE embedding IS NULL;

-- Verify embedding dimensions
SELECT id, array_length(embedding, 1) as dimensions
FROM articles_juridiques
WHERE embedding IS NOT NULL
LIMIT 1;
```

## Troubleshooting

### "Clé OpenAI manquante" (OpenAI key missing)

Set `OPENAI_API_KEY` in Supabase Vault:

```bash
supabase secrets set OPENAI_API_KEY="sk-..." --project-ref <project-id>
```

### "OpenAI embedding error"

Check:
1. API key is valid and has credits
2. API rate limits not exceeded
3. Text content is not too long (max 8191 tokens)

### Articles not getting embeddings

Check if:
1. `embedding` column exists on table
2. Function has SERVICE_ROLE_KEY permissions
3. Articles table has correct data

### Performance issues

- Reduce batch size from 50 to 25 (edit function)
- Call less frequently
- Use cheaper embedding model (`text-embedding-3-small` already optimized)

## Integration with Frontend

Once articles have embeddings, use semantic search:

```javascript
// 1. Generate embedding for user query
const queryEmbedding = await generateEmbedding(userQuery);

// 2. Search in Supabase
const { data } = await supabase
  .from('articles_juridiques')
  .select('id, numero_article, title')
  .order('embedding <-> ${queryEmbedding}', { ascending: true })
  .limit(10);

// Returns most relevant articles
```

## Architecture Diagram

```
New Article Added
        ↓
    Scheduled Trigger (cron)
    or Manual API Call
        ↓
  embed-articles function
        ↓
    Get 50 articles
    without embeddings
        ↓
    Create rich text:
    code + book + title + chapter + numero + contenu
        ↓
    Call OpenAI Embeddings API
        ↓
    Store vectors in Supabase
        ↓
    Return progress status
```

## Cost Optimization

- Using `text-embedding-3-small`: ~$0.02 per 1M tokens
- Average article: ~200 tokens
- Cost per article: ~$0.000004
- 1000 articles: ~$0.04

## Future Enhancements

- [ ] Re-embed articles when content changes
- [ ] Support for multiple embedding models
- [ ] Webhook triggers for new articles
- [ ] Batch deletion of old embeddings
- [ ] Export embeddings for backup
