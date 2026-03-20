#!/usr/bin/env bash
set -e

# ==============================================================================
# SynapseHub Startup Script
# This script initializes the environment, starts the necessary Docker containers,
# runs database migrations, and boots up the local development server.
# ==============================================================================

echo "🚀 Starting SynapseHub Development Environment..."

# 1. Setup environment variables
if [ ! -f .env ]; then
  echo "📝 Creating .env from .env.example..."
  cp .env.example .env
else
  echo "✅ .env file already exists."
fi

# 2. Install dependencies
echo "📦 Installing npm dependencies..."
npm install

# 3. Start infrastructure
echo "🐳 Starting PostgreSQL and MinIO infrastructure..."
docker compose up -d postgres minio minio-init

# 4. Wait for database to be ready
echo "⏳ Waiting for PostgreSQL to become healthy..."
# Basic wait loop for the postgres container's healthcheck
RETRIES=15
until docker inspect --format "{{json .State.Health.Status }}" synapsehub-db | grep -q '"healthy"'; do
  sleep 2
  RETRIES=$((RETRIES-1))
  if [ $RETRIES -le 0 ]; then
    echo "❌ Timeout waiting for PostgreSQL to become healthy."
    exit 1
  fi
  echo "   ... still waiting"
done
echo "✅ PostgreSQL is healthy!"

# Wait a moment for MinIO init job to finish bucket creation
sleep 3

# 5. Run migrations
echo "🗄️  Running database migrations..."
npm run db:migrate

# 6. Start the development server
# Extract PORT from .env or default to 3777
PORT=$(grep '^PORT=' .env | cut -d '=' -f2 || echo "3777")
PORT=${PORT:-3777}

echo "🌟 Checking if SynapseHub is already running on port $PORT..."
if lsof -Pi :$PORT -sTCP:LISTEN -t >/dev/null 2>&1; then
  echo "✅ SynapseHub is already running on port $PORT! Skipping server start."
else
  echo "🌟 Starting SynapseHub development server..."
  npm run dev
fi
