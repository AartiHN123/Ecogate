#!/usr/bin/env bash
set -e

echo "🌿 Setting up EcoGate..."

# Clone the repository
git clone https://github.com/YOUR_GITHUB_USERNAME/YOUR_REPO.git ecogate-deployment
cd ecogate-deployment/ecogate/server

echo "📦 Installing Node dependencies..."
npm install

echo "🚀 Launching EcoGate Setup..."
node setup.js
