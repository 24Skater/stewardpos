#!/bin/bash
# Deploy to Development Environment

set -e

echo "🚀 Deploying to Development Environment..."

# Load environment variables
if [ -f .env.dev ]; then
    export $(cat .env.dev | grep -v '^#' | xargs)
else
    echo "⚠️  Warning: .env.dev not found. Using defaults."
fi

# Build and start services
docker-compose -f docker-compose.yml -f docker-compose.dev.yml build
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

echo "✅ Development environment deployed!"
echo ""
echo "Services:"
echo "  Frontend: http://localhost:8081"
echo "  Backend:  http://localhost:3002"
echo "  Database: localhost:5433"
echo "  MinIO:    http://localhost:9003"

