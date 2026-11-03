// body-parser / raw-body use iconv-lite only to decode request bodies. Its Node build is
// not usable in the Workers bundle, and the runtime already ships TextDecoder, which covers
// UTF-8 (all our JSON traffic) and the common legacy charsets.
export function encodingExists(encoding: string): boolean {
  try {
    new TextDecoder(encoding);
    return true;
  } catch {
    return false;
  }
}

export function decode(buf: Uint8Array, encoding: string): string {
  return new TextDecoder(encoding).decode(buf);
}

export function encode(str: string): Uint8Array {
  return new TextEncoder().encode(str);
}

export function getDecoder(encoding: string) {
  const decoder = new TextDecoder(encoding);
  return {
    write: (chunk: Uint8Array) => decoder.decode(chunk, { stream: true }),
    end: () => decoder.decode(),
  };
}

const iconv = { encodingExists, decode, encode, getDecoder };
export default iconv;
