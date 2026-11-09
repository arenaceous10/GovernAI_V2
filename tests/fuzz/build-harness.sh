#!/bin/sh
# Bundles the store (JSX) so the workflow fuzz can run it in Node with jsdom.
cd "$(dirname "$0")/../.." && npx esbuild tests/fuzz/harness.jsx --bundle --platform=node --format=esm --jsx=automatic \
  --outfile=tests/fuzz/.harness.mjs --loader:.css=empty --packages=external --log-level=warning \
  --define:import.meta.env.VITE_SUPABASE_URL=undefined --define:import.meta.env.VITE_SUPABASE_ANON_KEY=undefined \
  --define:import.meta.env.VITE_EVIDENCE_PUBLIC_KEY=undefined
