import { describe, expect, it } from 'vitest';
import { dcExportName } from './export.js';

describe('dcExportName', () => {
  it('keeps letters of every script and replaces separators', () => {
    expect(dcExportName('صفحة عربية', 'x')).toBe('صفحة عربية');
    expect(dcExportName('a/b:c', 'x')).toBe('a_b_c');
    expect(dcExportName('', 'id-1')).toBe('id-1');
  });
});
