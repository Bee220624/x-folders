import { defineConfig } from 'wxt';
import preact from '@preact/preset-vite';

// Preact is wired manually: WXT ships official modules for React/Vue/Svelte/Solid
// only — there is no @wxt-dev/module-preact. See docs/architecture.md.
export default defineConfig({
  // WXT derives its `@` alias and its entrypoint lookup from srcDir, so keeping
  // everything under src/ is what makes `@/...` mean the same thing to the
  // bundler and to tsc. Splitting them is how you get a green typecheck and a
  // build that cannot resolve a single import.
  srcDir: 'src',
  outDir: '.output',
  // publicDir defaults to <rootDir>/public, NOT <srcDir>/public. Leaving the
  // icons under src/ builds and zips cleanly but ships a manifest referencing
  // files that are not in the bundle, and Chrome refuses to load it.
  publicDir: 'public',
  vite: () => ({
    plugins: [preact()],
  }),
  manifest: {
    name: 'X Folders',
    description: '在 X 网页内新增本地文件夹收藏系统。数据只保存在本机，无后端、无遥测。',
    version: '0.1.0',
    // `storage` backs the cross-tab change channel (a tiny revision record only).
    // `unlimitedStorage` exempts our IndexedDB from quota + eviction, which the
    // "data survives a reload" requirement depends on.
    permissions: ['storage', 'unlimitedStorage'],
    // Extension-root-relative, no leading slash — the conventional form Chrome
    // resolves without ambiguity.
    icons: {
      16: 'icon/16.png',
      32: 'icon/32.png',
      48: 'icon/48.png',
      128: 'icon/128.png',
    },
  },
});
