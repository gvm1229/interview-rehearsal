import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({
  plugins:[react()],
  resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},
  server:{
    host:'127.0.0.1',
    port:5173,
    strictPort:true,
    proxy:{'/api':'http://127.0.0.1:4173'},
    fs:{deny:['.env', '.env.*', '*.{crt,pem,key,p12,pfx,cer,der}', '.npmrc', '.yarnrc.yml', '**/.git/**', '**/data/private/**']},
    watch:{ignored:'**/data/private/**'},
  },
  build:{outDir:'dist/app'},
});
