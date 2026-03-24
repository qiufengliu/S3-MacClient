import { build } from 'esbuild';
import { copyFileSync, mkdirSync } from 'fs';

await build({
  entryPoints: ['src/renderer/index.tsx'],
  bundle: true,
  outfile: 'dist/renderer/bundle.js',
  platform: 'browser',
  format: 'iife',
  jsx: 'automatic',
  loader: { '.tsx': 'tsx', '.ts': 'ts', '.css': 'css' },
  define: { 'process.env.NODE_ENV': '"production"' },
}).catch(() => process.exit(1));

// Copy index.html and inject bundle.css link
mkdirSync('dist/renderer', { recursive: true });
copyFileSync('src/renderer/index.html', 'dist/renderer/index.html');
