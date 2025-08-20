// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';
import legacy from '@vitejs/plugin-legacy';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    plugins: [
      // @ts-ignore
      legacy({
        targets: ['ios_saf >= 4'],
        additionalLegacyPolyfills: ['regenerator-runtime/runtime']
      })
    ]
  }
});