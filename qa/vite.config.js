import {defineConfig} from 'vite';
import react from '@vitejs/plugin-react';
import {fileURLToPath} from 'node:url';
export default defineConfig({optimizeDeps:{entries:['qa/operator/index.html']},plugins:[{name:'qa-only-client',enforce:'pre',resolveId(id){if(id==='./supabaseClient')return fileURLToPath(new URL('./operator/mock.js',import.meta.url));}},react()],server:{host:'127.0.0.1',port:4174,strictPort:true}});
