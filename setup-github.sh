#!/bin/bash
# ============================================================
# CylinderTrack — Push to GitHub
# ============================================================
# Run this script from inside the cylindertrack folder.
#
# Prerequisites:
#   1. Install Git: https://git-scm.com/downloads
#   2. Create a NEW empty repo on GitHub (do NOT add a README):
#      https://github.com/new
#      Name: cylindertrack
#      Visibility: Private
#      Do NOT tick "Add a README file"
#      Click "Create repository"
#   3. Copy your repo URL (e.g. https://github.com/YOUR-USERNAME/cylindertrack.git)
#   4. Run this script:
#      chmod +x setup-github.sh
#      ./setup-github.sh https://github.com/YOUR-USERNAME/cylindertrack.git
# ============================================================

REPO_URL=$1

if [ -z "$REPO_URL" ]; then
  echo ""
  echo "Usage: ./setup-github.sh https://github.com/YOUR-USERNAME/cylindertrack.git"
  echo ""
  echo "Create an EMPTY repo on GitHub first (no README), then pass the URL."
  exit 1
fi

echo ""
echo "Initializing git repo..."
git init
git add -A
git commit -m "Initial commit — CylinderTrack gas rental management"

echo ""
echo "Pushing to GitHub..."
git branch -M main
git remote add origin "$REPO_URL"
git push -u origin main

echo ""
echo "✅ Done! Your code is on GitHub."
echo ""
echo "Next steps:"
echo "  1. Go to https://railway.app"
echo "  2. New Project → Deploy from GitHub Repo → select cylindertrack"
echo "  3. Railway detects the Dockerfile automatically"
echo "  4. Under Settings → Networking → Generate Domain"
echo "  5. Deploy!"
echo ""
