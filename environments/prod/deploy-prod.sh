#!/bin/bash
# Deploy to Production Environment
# IMPORTANT: Review all settings before running!
# Run from environments/prod/ directory

set -e

echo "🚨 PRODUCTION DEPLOYMENT"
echo "⚠️  Make sure you have:"
echo "   1. Strong passwords in .env.prod"
echo "   2. JWT_SECRET set (min 32 characters)"
echo "   3. CORS_ORIGIN set to your production domain"
echo "   4. Reviewed all security settings"
echo ""
read -p "Continue with production deployment? (yes/no): " confirm

if [ "$confirm" != "yes" ]; then
    echo "❌ Deployment cancelled."
    exit 1
fi

# Load environment variables
if [ -f .env.prod ]; then
    export $(cat .env.prod | grep -v '^#' | xargs)
elif [ -f ../../.env.prod.example ]; then
    echo "❌ Error: .env.prod not found!"
    echo "   Copy ../../.env.prod.example to .env.prod and configure it."
    exit 1
else
    echo "❌ Error: .env.prod not found!"
    echo "   Create .env.prod with production settings."
    exit 1
fi

# Validate critical settings
if [ -z "$JWT_SECRET" ] || [ ${#JWT_SECRET} -lt 32 ]; then
    echo "❌ Error: JWT_SECRET must be at least 32 characters!"
    exit 1
fi

if [ -z "$CORS_ORIGIN" ]; then
    echo "❌ Error: CORS_ORIGIN must be set!"
    exit 1
fi

# Build and start services (reference root docker-compose.yml as base)
echo "🔨 Building production images..."
docker-compose -f ../../docker-compose.yml -f docker-compose.prod.yml build

echo "🚀 Starting production services..."
docker-compose -f ../../docker-compose.yml -f docker-compose.prod.yml up -d

echo "✅ Production environment deployed!"
echo ""
echo "⚠️  Next steps:"
echo "   1. Verify all services are running: docker-compose -f docker-compose.yml -f docker-compose.prod.yml ps"
echo "   2. Check logs: docker-compose -f docker-compose.yml -f docker-compose.prod.yml logs -f"
echo "   3. Test the application endpoints"
echo "   4. Set up monitoring and backups"

