// Pure-JS ZIP/CBZ creator (STORE method, no compression needed for images)

let crc32Table: Uint32Array | null = null;

function makeCrc32Table(): Uint32Array {
  if (crc32Table) return crc32Table;
  crc32Table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc32Table[i] = c;
  }
  return crc32Table;
}

function crc32(data: Uint8Array): number {
  const table = makeCrc32Table();
  let crc = 0xffffffff;
  for (const byte of data) crc = table[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function u16(val: number): Uint8Array {
  return new Uint8Array([val & 0xff, (val >> 8) & 0xff]);
}

function u32(val: number): Uint8Array {
  return new Uint8Array([val & 0xff, (val >> 8) & 0xff, (val >> 16) & 0xff, (val >> 24) & 0xff]);
}

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let pos = 0;
  for (const p of parts) { out.set(p, pos); pos += p.length; }
  return out;
}

function blobExt(blob: Blob): string {
  if (blob.type.includes("png")) return "png";
  if (blob.type.includes("webp")) return "webp";
  if (blob.type.includes("gif")) return "gif";
  return "jpg";
}

export async function createCbzBlob(
  blobs: Blob[],
  mangaTitle: string,
  chapterLabel: string
): Promise<Blob> {
  const encoder = new TextEncoder();
  const now = new Date();
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) >>> 0;
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) >>> 0;

  const localParts: Uint8Array[] = [];
  const centralParts: Uint8Array[] = [];
  let offset = 0;

  for (let i = 0; i < blobs.length; i++) {
    const ext = blobExt(blobs[i]);
    const name = `${mangaTitle}/${chapterLabel}/page_${String(i + 1).padStart(4, "0")}.${ext}`;
    const nameBytes = encoder.encode(name);
    const data = new Uint8Array(await blobs[i].arrayBuffer());
    const crc = crc32(data);
    const size = data.length;

    const localHeader = concat(
      new Uint8Array([0x50, 0x4b, 0x03, 0x04]),
      u16(20), u16(0), u16(0),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(size), u32(size),
      u16(nameBytes.length), u16(0),
      nameBytes
    );

    localParts.push(localHeader, data);

    const centralEntry = concat(
      new Uint8Array([0x50, 0x4b, 0x01, 0x02]),
      u16(20), u16(20), u16(0), u16(0),
      u16(dosTime), u16(dosDate),
      u32(crc), u32(size), u32(size),
      u16(nameBytes.length), u16(0), u16(0),
      u16(0), u16(0), u32(0),
      u32(offset),
      nameBytes
    );
    centralParts.push(centralEntry);
    offset += localHeader.length + data.length;
  }

  const centralDir = concat(...centralParts);
  const eocd = concat(
    new Uint8Array([0x50, 0x4b, 0x05, 0x06]),
    u16(0), u16(0),
    u16(blobs.length), u16(blobs.length),
    u32(centralDir.length), u32(offset),
    u16(0)
  );

  return new Blob([...localParts, centralDir, eocd], { type: "application/x-cbz" });
}

export function triggerFileDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  if (a.parentNode === document.body) {
    document.body.removeChild(a);
  }
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}
