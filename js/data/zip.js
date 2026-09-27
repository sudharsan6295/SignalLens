/* Minimal ZIP reader using the browser's native DecompressionStream — no library.
   Supports stored (0) and deflate (8) entries, which is what the claude.ai and
   ChatGPT exports use. ZIP64 (archives over 4 GB) isn't supported. */
(function () {
  "use strict";
  const Lens = window.Lens;

  const SIG_EOCD = 0x06054b50;
  const SIG_CENTRAL = 0x02014b50;
  const SIG_LOCAL = 0x04034b50;

  async function inflateRaw(bytes) {
    if (typeof DecompressionStream === "undefined") {
      throw new Error("This browser can't unzip files. Unzip the export and import conversations.json instead.");
    }
    const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  /** -> [{ name, size, read(): Promise<Uint8Array> }] */
  function listEntries(buffer) {
    const view = new DataView(buffer);
    const len = buffer.byteLength;
    let eocd = -1;
    for (let i = len - 22; i >= Math.max(0, len - 65557); i--) {
      if (view.getUint32(i, true) === SIG_EOCD) { eocd = i; break; }
    }
    if (eocd < 0) throw new Error("This doesn't look like a valid .zip file.");
    const count = view.getUint16(eocd + 10, true);
    let ptr = view.getUint32(eocd + 16, true);
    if (ptr === 0xffffffff) throw new Error("ZIP64 archives aren't supported. Unzip it and import the .json files instead.");

    const utf8 = new TextDecoder("utf-8");
    const entries = [];
    for (let n = 0; n < count; n++) {
      if (view.getUint32(ptr, true) !== SIG_CENTRAL) throw new Error("Corrupt .zip central directory.");
      const method = view.getUint16(ptr + 10, true);
      const compSize = view.getUint32(ptr + 20, true);
      const size = view.getUint32(ptr + 24, true);
      const nameLen = view.getUint16(ptr + 28, true);
      const extraLen = view.getUint16(ptr + 30, true);
      const commentLen = view.getUint16(ptr + 32, true);
      const localOffset = view.getUint32(ptr + 42, true);
      const name = utf8.decode(new Uint8Array(buffer, ptr + 46, nameLen));
      ptr += 46 + nameLen + extraLen + commentLen;
      if (name.endsWith("/")) continue; // directory

      entries.push({
        name,
        size,
        async read() {
          if (view.getUint32(localOffset, true) !== SIG_LOCAL) throw new Error(`Corrupt entry ${name}`);
          const lNameLen = view.getUint16(localOffset + 26, true);
          const lExtraLen = view.getUint16(localOffset + 28, true);
          const start = localOffset + 30 + lNameLen + lExtraLen;
          const data = new Uint8Array(buffer, start, compSize);
          if (method === 0) return data;
          if (method === 8) return inflateRaw(data);
          throw new Error(`${name} uses an unsupported compression method (${method}).`);
        },
      });
    }
    return entries;
  }

  Lens.zip = {
    listEntries,
    async readText(entry) { return new TextDecoder("utf-8").decode(await entry.read()); },
  };
})();
