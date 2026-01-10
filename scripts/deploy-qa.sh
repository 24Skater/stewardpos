#!/bin/bash
# Deploy to QA/Staging Environment

set -e

echo "🚀 Deploying to QA/Staging Environment..."

# Load environment variables
if [ -f .env.qa ]; then
    export $(cat .env.qa | grep -v '^#' | xargs)
else
    echo "⚠️  Warning: .env.qa not found. Using defaults."
fi

# Build and start services
docker-compose -f docker-compose.yml -f docker-compose.qa.yml build
docker-compose -f docker-compose.yml -f docker-compose.qa.yml up -d

echo "✅ QA/Staging environment deployed!"
echo ""
echo "Services:"
echo "  Frontend: http://localhost:8082"
echo "  Backend:  http://localhost:3003"
echo "  Database: localhost:5434"
echo "  MinIO:    http://localhost:9005"

