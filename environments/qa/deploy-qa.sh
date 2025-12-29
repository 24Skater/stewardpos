#!/bin/bash
# Deploy to QA/Staging Environment
# Run from environments/qa/ directory

set -e

echo "🚀 Deploying to QA/Staging Environment..."

# Load environment variables
if [ -f .env.qa ]; then
    export $(cat .env.qa | grep -v '^#' | xargs)
elif [ -f ../../.env.qa.example ]; then
    echo "⚠️  Warning: .env.qa not found. Copy from ../../.env.qa.example"
else
    echo "⚠️  Warning: .env.qa not found. Using defaults."
fi

# Build and start services (reference root docker-compose.yml as base)
docker-compose -f ../../docker-compose.yml -f docker-compose.qa.yml build
docker-compose -f ../../docker-compose.yml -f docker-compose.qa.yml up -d

echo "✅ QA/Staging environment deployed!"
echo ""
echo "Services:"
echo "  Frontend: http://localhost:8082"
echo "  Backend:  http://localhost:3003"
echo "  Database: localhost:5434"
echo "  MinIO:    http://localhost:9005"

