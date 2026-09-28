import { describe, expect, it } from 'vitest';
import { shadowMode } from '@/ui/shared/shadowMode';

describe('shadowMode', () => {
  it('is closed in every build except the browser-test build', () => {
    expect(import.meta.env.MODE).not.toBe('e2e');
    expect(shadowMode()).toBe('closed');
  });
});
