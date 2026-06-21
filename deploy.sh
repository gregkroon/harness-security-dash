#!/bin/bash
set -e

echo "🚀 Harness Security Dashboard - Easy Deploy"
echo "==========================================="
echo ""

# Check if .env exists
if [ ! -f .env ]; then
    echo "❌ .env file not found!"
    echo ""
    echo "Please create .env file with your Harness credentials:"
    echo ""
    echo "  cp .env.example .env"
    echo "  vim .env  # Add your HARNESS_ACCOUNT_ID and HARNESS_API_KEY"
    echo ""
    exit 1
fi

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    echo "❌ Docker is not running!"
    echo "Please start Docker and try again."
    exit 1
fi

echo "✓ Docker is running"
echo "✓ .env file found"
echo ""

# Build and start
echo "📦 Building container..."
docker-compose build

echo ""
echo "🚀 Starting container..."
docker-compose up -d

echo ""
echo "⏳ Waiting for container to be healthy..."
sleep 5

# Wait for health check
for i in {1..30}; do
    if docker-compose ps | grep -q "healthy"; then
        echo "✓ Container is healthy!"
        break
    fi
    echo "   Waiting... ($i/30)"
    sleep 2
done

echo ""
echo "📊 Triggering initial sync..."
curl -s -X POST http://localhost:8080/api/sync > /dev/null || true

echo ""
echo "=========================================="
echo "✅ Deployment complete!"
echo ""
echo "Dashboard URL: http://localhost:8080"
echo ""
echo "Useful commands:"
echo "  docker-compose logs -f        # View logs"
echo "  docker-compose ps             # Check status"
echo "  docker-compose down           # Stop"
echo "  docker-compose restart        # Restart"
echo ""
echo "The first sync will take 30-60 seconds."
echo "After that, searches are instant (<100ms)."
echo ""
