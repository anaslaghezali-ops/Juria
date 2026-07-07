#!/bin/bash

# Supabase Edge Functions Deployment Script
# Usage: ./supabase/deploy.sh [production|staging|local]

set -e

ENVIRONMENT=${1:-production}
PROJECT_ID=${SUPABASE_PROJECT_ID}

if [ -z "$PROJECT_ID" ]; then
  echo "❌ Error: SUPABASE_PROJECT_ID environment variable not set"
  echo "   Set it with: export SUPABASE_PROJECT_ID=your-project-id"
  exit 1
fi

echo "🚀 Deploying Edge Functions to $ENVIRONMENT environment..."
echo "   Project ID: $PROJECT_ID"
echo ""

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
  echo "📦 Installing Supabase CLI..."
  npm install -g supabase
fi

# Authenticate with Supabase (requires SUPABASE_ACCESS_TOKEN)
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
  echo "⚠️  Warning: SUPABASE_ACCESS_TOKEN not set"
  echo "   Login with: supabase login"
fi

# Deploy functions
echo "📤 Deploying Edge Functions..."
echo ""

FUNCTIONS=(
  "smart-endpoint"
  "chat-with-doc"
  "embed-articles"
  "generate-embeddings"
  "generate-keywords"
  "get-embedding"
  "process-chunks"
  "vector-search"
)

count=1
for func in "${FUNCTIONS[@]}"; do
  echo "${count}️⃣  Deploying $func..."
  supabase functions deploy "$func" --project-ref $PROJECT_ID
  echo "   ✅ $func deployed"
  echo ""
  count=$((count+1))
done

echo "✅ All 8 Edge Functions deployed successfully!"
echo ""
echo "📋 Available Functions:"
echo ""
echo "  1. smart-endpoint"
echo "     Purpose: AI-powered legal document analysis + user quota management"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/smart-endpoint"
echo ""
echo "  2. chat-with-doc"
echo "     Purpose: GPT-powered legal document chat (4 modes: classifier, summary, global, RAG)"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/chat-with-doc"
echo ""
echo "  3. embed-articles"
echo "     Purpose: Batch generate OpenAI embeddings for legal articles"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/embed-articles"
echo ""
echo "  4. generate-embeddings"
echo "     Purpose: Generate embeddings (alternate/legacy version)"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/generate-embeddings"
echo ""
echo "  5. generate-keywords"
echo "     Purpose: Extract and enrich keywords from legal articles via GPT"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/generate-keywords"
echo ""
echo "  6. get-embedding"
echo "     Purpose: Get embedding for arbitrary text (on-demand)"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/get-embedding"
echo ""
echo "  7. process-chunks"
echo "     Purpose: Process document chunks with embeddings and indexing status"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/process-chunks"
echo ""
echo "  8. vector-search"
echo "     Purpose: Semantic search with vector similarity queries"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/vector-search"
echo ""
echo ""
echo "💡 Next steps:"
echo "   1. Set SUPABASE_ACCESS_TOKEN environment variable"
echo "   2. Configure GitHub Actions secrets (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID)"
echo "   3. Update frontend config to use the deployed function"
echo ""
