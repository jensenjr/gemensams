#!/bin/bash

set -euxo pipefail

npx prisma migrate deploy
node scripts/seed.mjs || echo "Seed step skipped/failed (continuing)"
exec npm run start
