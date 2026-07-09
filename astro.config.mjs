// @ts-check
import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// https://astro.build/config
export default defineConfig({
  output: 'server',
  adapter: cloudflare(),
  vite: {
    build: {
      // Vite's default CSS minifier (esbuild) rewrites top/right/bottom/left:0
      // into `inset:0` (Safari 14.1+/2021), which old Safari drops entirely —
      // blanking the nav-bar chrome. Pin an old CSS target so esbuild never
      // emits modern shorthands. (autoprefixer still adds -webkit- prefixes via
      // the browserslist in package.json; esbuild does not strip those.)
      cssTarget: ['safari5', 'ios5', 'chrome60']
    }
    // Note: the legacy Vite JS-transpile plugin was removed — it only rewrites
    // client-side JS bundles, and this site ships zero client JS, so it was
    // inert. Legacy support lives in the CSS pipeline (cssTarget + browserslist).
  }
});