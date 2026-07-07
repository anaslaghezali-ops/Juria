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
echo "📤 Deploying smart-endpoint function..."
supabase functions deploy smart-endpoint --project-ref $PROJECT_ID

echo ""
echo "✅ Deployment successful!"
echo ""
echo "📋 Function Details:"
echo "   Name: smart-endpoint"
echo "   URL: https://$PROJECT_ID.supabase.co/functions/v1/smart-endpoint"
echo "   Method: POST"
echo ""
echo "🔑 Required Headers:"
echo "   Authorization: Bearer <user-jwt-token>"
echo "   Content-Type: application/json"
echo ""
echo "📝 Example Request:"
echo '{
  "operation": "read",
  "table": "folders",
  "filters": { "id": "fold_123" },
  "orgId": "org_123",
  "userId": "user_456"
}'
echo ""
echo "💡 Next steps:"
echo "   1. Set SUPABASE_ACCESS_TOKEN environment variable"
echo "   2. Configure GitHub Actions secrets (SUPABASE_ACCESS_TOKEN, SUPABASE_PROJECT_ID)"
echo "   3. Update frontend config to use the deployed function"
echo ""
