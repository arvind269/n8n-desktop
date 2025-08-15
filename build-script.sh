#!/bin/bash
set -e
echo "⚙️ Setting environment for Electron 35 + mac M2 (arm64) + C++20..."
export CXXFLAGS="-std=c++20"
export CXX=clang++
export npm_config_arch=arm64
export npm_config_target_arch=arm64
export npm_config_target=35.0.0
export npm_config_runtime=electron
export npm_config_disturl=https://electronjs.org/headers
export npm_config_build_from_source=true

echo "📦 Installing dependencies..."

npm install --verbose

echo "📦 Building macOS app (no sign)..."
npm run build-mac-no-sign

echo "✅ Build complete! You can find the app in the dist/ folder."
