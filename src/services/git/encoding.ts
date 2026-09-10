/**
 * UTF-8-safe base64 helpers for Git provider payloads.
 *
 * The native `btoa` / `atob` pair operates on Latin-1 code units, so passing a
 * UTF-8 string that contains code points > U+00FF throws
 * `InvalidCharacterError`. Git providers (GitHub, GitLab, Gitea) expect
 * base64-encoded *bytes*, so we go through `TextEncoder`/`TextDecoder` to round
 * trip UTF-8 cleanly.
 */

export function encodeContentBase64(content: string | Uint8Array): string {
  const bytes = typeof content === 'string' ? new TextEncoder().encode(content) : content;
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary);
}

export function decodeBytesBase64(b64: string): Uint8Array {
  const binary = atob(b64.replace(/\s/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

export function decodeContentBase64(b64: string): string {
  return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(decodeBytesBase64(b64));
}
