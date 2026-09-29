import { describe, expect, it } from 'vitest';
import { createHandlers } from '@/background/rpc/handlers';

describe('health.ping', () => {
  it('reports the version the manifest declares, not a hard-coded one', async () => {
    const reply = await createHandlers()['health.ping'](undefined);
    expect(reply).toEqual({ ok: true, version: '0.0.0-test' });
  });
});
