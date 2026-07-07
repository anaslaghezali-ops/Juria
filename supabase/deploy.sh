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

echo "1️⃣  Deploying smart-endpoint..."
supabase functions deploy smart-endpoint --project-ref $PROJECT_ID
echo "   ✅ smart-endpoint deployed"
echo ""

echo "2️⃣  Deploying embed-articles..."
supabase functions deploy embed-articles --project-ref $PROJECT_ID
echo "   ✅ embed-articles deployed"
echo ""

echo "✅ All Edge Functions deployed successfully!"
echo ""
echo "📋 Available Functions:"
echo ""
echo "  1. smart-endpoint (General Database Operations)"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/smart-endpoint"
echo "     Method: POST"
echo "     Purpose: Secure CRUD operations with org-level access control"
echo ""
echo "  2. embed-articles (AI Embeddings)"
echo "     URL: https://$PROJECT_ID.supabase.co/functions/v1/embed-articles"
echo "     Method: POST"
echo "     Purpose: Generate OpenAI embeddings for legal articles"
echo ""
echo ""
echo "💡 Next steps:"
echo "   1. Set SUPABASE_ACCESS_TOKEN environment variable"
echo "   2. Configure GitHub Actions secrets (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID)"
echo "   3. Update frontend config to use the deployed function"
echo ""
