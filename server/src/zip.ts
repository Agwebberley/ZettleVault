// Minimal streaming ZIP writer: store-only (photos are already JPEG), one entry in memory at a time.
// ponytail: classic ZIP limits — 65,535 entries and 4 GB. That is ~20k cards with two photos each;
// switch to zip64 (or a library) if a vault ever gets there. It fails loudly rather than corrupting.
import { crc32 } from 'node:zlib'

const UTF8_NAMES = 0x0800
const DOS_DATE = (1 << 5) | 1 // 1980-01-01: timestamps would only make exports non-reproducible

export async function writeZip(write: (chunk: Uint8Array) => Promise<unknown>, entries: AsyncIterable<{ name: string; data: Buffer }>) {
  const central: Buffer[] = []
  let offset = 0
  for await (const { name, data } of entries) {
    const nameBytes = Buffer.from(name, 'utf8')
    const crc = crc32(data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(UTF8_NAMES, 6)
    local.writeUInt16LE(0, 8) // method: store
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(data.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(nameBytes.length, 26)

    const header = Buffer.alloc(46)
    header.writeUInt32LE(0x02014b50, 0)
    header.writeUInt16LE(20, 4) // version made by
    local.copy(header, 6, 4, 30) // version needed … name length: identical layout
    header.writeUInt32LE(offset, 42)
    central.push(header, nameBytes)

    await write(local)
    await write(nameBytes)
    await write(data)
    offset += 30 + nameBytes.length + data.length
    if (offset > 0xffffffff || central.length / 2 > 0xffff) throw new Error('export too large for a classic zip')
  }

  const directory = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(central.length / 2, 8)
  end.writeUInt16LE(central.length / 2, 10)
  end.writeUInt32LE(directory.length, 12)
  end.writeUInt32LE(offset, 16)
  await write(directory)
  await write(end)
}
