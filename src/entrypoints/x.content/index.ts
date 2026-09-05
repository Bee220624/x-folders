import { XRuntime } from '@/hosts/x/XRuntime';
import { applyStoredLogLevel, createLogger } from '@/utils/logger';

const log = createLogger('content');

export default defineContentScript({
  matches: ['https://x.com/*', 'https://twitter.com/*'],
  runAt: 'document_idle',
  // 'ui' keeps our CSS out of x.com's document. The default 'manifest' mode
  // writes it into manifest.content_scripts[].css, where it both leaks selectors
  // into X's own DOM and cannot cross a shadow boundary to reach our UI.
  cssInjectionMode: 'ui',

  main(ctx) {
    // The embedded-tweet iframe and X's own sub-frames are out of scope; only
    // the top-level app gets instrumented.
    if (window.top !== window.self) return;

    // Not awaited: startup must not wait on storage. Early records come out at
    // the default `warn` level, which is what they were before this resolves.
    void applyStoredLogLevel();

    const runtime = new XRuntime();
    runtime.start();
    void runtime.ping();

    // WXT fires this when the extension is reloaded or updated and this script's
    // context is invalidated. Everything must come down: observers, timers,
    // body-level shadow hosts, Preact roots and injected buttons.
    ctx.onInvalidated(() => {
      log.debug('context invalidated, disposing');
      runtime.dispose();
    });
  },
});
