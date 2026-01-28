#!/bin/bash

# Production Deploy Script
# Usage: ./scripts/deploy.sh

set -e

APP_NAME="api-alpha-pro"
APP_DIR="/root/api-alpha-pro"

echo "=========================================="
echo "  Deploying $APP_NAME"
echo "=========================================="

cd $APP_DIR

# Pull latest changes
echo "[1/5] Pulling latest changes..."
git pull origin main

# Install dependencies
echo "[2/5] Installing dependencies..."
npm install --production=false

# Generate Prisma client
echo "[3/5] Generating Prisma client..."
npx prisma generate

# Build the application
echo "[4/5] Building application..."
npm run build

# Reload PM2 (zero downtime)
echo "[5/5] Reloading PM2..."
pm2 reload $APP_NAME

# Save PM2 state
pm2 save

echo "=========================================="
echo "  Deployment completed successfully!"
echo "=========================================="
pm2 status $APP_NAME
