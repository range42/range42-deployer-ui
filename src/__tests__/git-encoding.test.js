import { describe, it, expect } from 'vitest';
import { encodeContentBase64, decodeContentBase64 } from '../services/git/encoding';

describe('git encoding', () => {
  it('round-trips UTF-8 strings (accents + emoji)', () => {
    const input = 'héllo 🌍';
    const encoded = encodeContentBase64(input);
    expect(typeof encoded).toBe('string');
    expect(decodeContentBase64(encoded)).toBe(input);
  });

  it('round-trips ASCII text', () => {
    const input = 'hello world';
    expect(decodeContentBase64(encodeContentBase64(input))).toBe(input);
  });

  it('encodes raw bytes to valid base64', () => {
    const bytes = new Uint8Array([0xff, 0xfe]);
    const encoded = encodeContentBase64(bytes);
    // Must be valid base64 and decode back to the same 2 bytes.
    expect(/^[A-Za-z0-9+/]+=*$/.test(encoded)).toBe(true);
    const roundtrip = atob(encoded);
    expect(roundtrip.charCodeAt(0)).toBe(0xff);
    expect(roundtrip.charCodeAt(1)).toBe(0xfe);
  });

  it('tolerates whitespace/newlines in base64 input on decode', () => {
    const input = 'multi line content with UTF-8: café';
    const encoded = encodeContentBase64(input);
    // Simulate GitHub-style line-wrapped base64.
    const wrapped = encoded.replace(/(.{4})/g, '$1\n');
    expect(decodeContentBase64(wrapped)).toBe(input);
  });

  it('throws on UTF-8 input via raw btoa (regression sanity check)', () => {
    expect(() => btoa('héllo 🌍')).toThrow();
  });
});
