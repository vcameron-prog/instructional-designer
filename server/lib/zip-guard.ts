const MAX_ENTRY_COUNT = 1000;
const MAX_DECOMPRESSED_BYTES = 50 * 1024 * 1024;

const ZIP64_SIZE_MARKER = 0xffffffff;
const ZIP64_COUNT_MARKER = 0xffff;

export function inspectZip(buffer: Buffer, label = "file"): void {
  const EOCD_SIG = 0x06054b50;
  const MIN_EOCD_SIZE = 22;

  if (buffer.length < MIN_EOCD_SIZE) {
    throw new Error(`Invalid ZIP ${label}: file too small`);
  }

  let eocdOffset = -1;
  const searchStart = Math.max(0, buffer.length - MIN_EOCD_SIZE - 65535);
  for (let i = buffer.length - MIN_EOCD_SIZE; i >= searchStart; i--) {
    if (buffer.readUInt32LE(i) === EOCD_SIG) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset === -1) {
    throw new Error(`Invalid ZIP ${label}: end-of-central-directory not found`);
  }

  const totalEntries = buffer.readUInt16LE(eocdOffset + 10);
  const centralDirOffset = buffer.readUInt32LE(eocdOffset + 16);

  if (totalEntries === ZIP64_COUNT_MARKER || centralDirOffset === ZIP64_SIZE_MARKER) {
    throw new Error(`Rejected ${label}: ZIP64 archives are not accepted`);
  }

  if (totalEntries > MAX_ENTRY_COUNT) {
    throw new Error(
      `Rejected ${label}: too many ZIP entries (${totalEntries}; limit ${MAX_ENTRY_COUNT})`,
    );
  }

  if (centralDirOffset >= buffer.length) {
    throw new Error(`Invalid ZIP ${label}: central directory offset out of range`);
  }

  const CD_SIG = 0x02014b50;
  let offset = centralDirOffset;
  let totalUncompressed = 0;

  for (let i = 0; i < totalEntries; i++) {
    if (offset + 46 > buffer.length) {
      throw new Error(
        `Invalid ZIP ${label}: central directory entry ${i} truncated (offset ${offset} exceeds buffer length ${buffer.length})`,
      );
    }

    const sig = buffer.readUInt32LE(offset);
    if (sig !== CD_SIG) {
      throw new Error(
        `Invalid ZIP ${label}: unexpected signature 0x${sig.toString(16)} at central directory entry ${i} (offset ${offset})`,
      );
    }

    const uncompressedSize = buffer.readUInt32LE(offset + 24);
    if (uncompressedSize === ZIP64_SIZE_MARKER) {
      throw new Error(
        `Rejected ${label}: entry ${i} uses ZIP64 extended size fields which are not accepted`,
      );
    }

    totalUncompressed += uncompressedSize;

    if (totalUncompressed > MAX_DECOMPRESSED_BYTES) {
      throw new Error(
        `Rejected ${label}: decompressed content exceeds ${MAX_DECOMPRESSED_BYTES / 1024 / 1024} MB limit`,
      );
    }

    const fileNameLen = buffer.readUInt16LE(offset + 28);
    const extraLen = buffer.readUInt16LE(offset + 30);
    const commentLen = buffer.readUInt16LE(offset + 32);

    offset += 46 + fileNameLen + extraLen + commentLen;
  }
}
