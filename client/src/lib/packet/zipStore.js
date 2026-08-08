// A minimal ZIP writer: STORE only, no compression, no dependency.
//
// Why STORE: every entry is a jsPDF built with compress:true, so its streams are already
// deflated — wrapping deflate around them again buys ~1% for real CPU. Why no library: the
// client has no zip dependency today, and the format's store-only subset is small enough to
// hold in one file (local headers + central directory + end record, CRC-32 over raw bytes).
// The server's `archiver` is Node-only and the packet PDFs deliberately never touch the
// server (the render happens in the browser; see WALK_PACKETS.md).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export const crc32 = (bytes) => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

// ZIP stores MS-DOS local time, 2-second resolution. Pre-1980 dates underflow the format,
// so they clamp to its epoch.
const dosDateTime = (date) => {
  const y = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1),
    date: ((y - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
};

// entries: [{ name: string, data: Uint8Array }] -> one ZIP as a Uint8Array.
// Names are encoded UTF-8 with the language-encoding flag set, so an accented street or
// campaign name survives every mainstream extractor.
export const zipStore = (entries, { date = new Date() } = {}) => {
  const enc = new TextEncoder();
  const { time, date: ddate } = dosDateTime(date);
  const locals = [];
  const centrals = [];
  let offset = 0;

  const u16 = (v) => [v & 0xff, (v >> 8) & 0xff];
  const u32 = (v) => [v & 0xff, (v >>> 8) & 0xff, (v >>> 16) & 0xff, (v >>> 24) & 0xff];

  for (const { name, data } of entries) {
    const nameBytes = enc.encode(name);
    const crc = crc32(data);
    const common = [
      ...u16(20), // version needed: 2.0
      ...u16(0x0800), // general purpose: UTF-8 names
      ...u16(0), // method: STORE
      ...u16(time), ...u16(ddate),
      ...u32(crc), ...u32(data.length), ...u32(data.length),
      ...u16(nameBytes.length), ...u16(0), // extra len
    ];
    const local = new Uint8Array([...u32(0x04034b50), ...common, ...nameBytes]);
    locals.push(local, data);
    centrals.push(
      new Uint8Array([
        ...u32(0x02014b50), ...u16(20), ...common,
        ...u16(0), ...u16(0), ...u16(0), // comment len, disk, internal attrs
        ...u32(0), // external attrs
        ...u32(offset),
        ...nameBytes,
      ])
    );
    offset += local.length + data.length;
  }

  const centralSize = centrals.reduce((n, c) => n + c.length, 0);
  const end = new Uint8Array([
    ...u32(0x06054b50), ...u16(0), ...u16(0),
    ...u16(entries.length), ...u16(entries.length),
    ...u32(centralSize), ...u32(offset), ...u16(0),
  ]);

  const total = offset + centralSize + end.length;
  const out = new Uint8Array(total);
  let p = 0;
  for (const part of [...locals, ...centrals, end]) { out.set(part, p); p += part.length; }
  return out;
};
