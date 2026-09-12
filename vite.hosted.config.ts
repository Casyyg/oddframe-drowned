import { defineConfig } from 'vite';
import { sites } from '@openai/sites-vite-plugin';
export default defineConfig({plugins:[sites()],publicDir:false,build:{outDir:'dist/server',emptyOutDir:true,ssr:'server/worker.mjs',minify:true,rollupOptions:{output:{entryFileNames:'index.js'}}}});
