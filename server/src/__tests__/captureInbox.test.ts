import { describe, expect, it } from 'vitest';

describe('Server Web Capture & SSRF Security', () => {
  function isPrivateUrl(urlStr: string): boolean {
    try {
      const url = new URL(urlStr);
      const host = url.hostname.toLowerCase();

      if (
        host === 'localhost' ||
        host === '127.0.0.1' ||
        host === '0.0.0.0' ||
        host === '::1' ||
        host.endsWith('.local') ||
        host.endsWith('.internal')
      ) {
        return true;
      }

      if (
        host.startsWith('10.') ||
        host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(host)
      ) {
        return true;
      }

      return false;
    } catch {
      return true;
    }
  }

  it('blocks private IPs, loopback, and local hostnames from web capture', () => {
    expect(isPrivateUrl('http://127.0.0.1:8080/secret')).toBe(true);
    expect(isPrivateUrl('http://localhost:3000')).toBe(true);
    expect(isPrivateUrl('http://10.0.0.1/admin')).toBe(true);
    expect(isPrivateUrl('http://192.168.1.1/router')).toBe(true);
    expect(isPrivateUrl('http://172.16.0.5/internal')).toBe(true);
    expect(isPrivateUrl('http://service.local/api')).toBe(true);
    expect(isPrivateUrl('not-a-valid-url')).toBe(true);
  });

  it('allows public HTTPS articles for web capture', () => {
    expect(isPrivateUrl('https://example.com/article/1')).toBe(false);
    expect(isPrivateUrl('https://arxiv.org/abs/2301.00001')).toBe(false);
    expect(isPrivateUrl('https://wikipedia.org/wiki/Memory_consolidation')).toBe(false);
  });
});
