export const ZIP_CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
export const ZIP_LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
export const ZIP64_U16_SENTINEL = 0xffff;
export const ZIP64_U32_SENTINEL = 0xffffffff;
export const ZIP_ENCRYPTED_FLAG = 0x0001;

const ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP_SYMLINK_FILE_TYPE = 0xa000;
const ZIP_FILE_TYPE_MASK = 0xf000;
const ZIP_END_OF_CENTRAL_DIRECTORY_MIN_SIZE = 22;
const ZIP_MAX_COMMENT_SIZE = 0xffff;

export interface ZipEndOfCentralDirectory {
  diskNumber: number;
  centralDirectoryDiskNumber: number;
  entriesOnThisDisk: number;
  totalEntries: number;
  centralDirectorySize: number;
  centralDirectoryOffset: number;
}

export interface ZipCentralDirectoryEntryHeader {
  flags: number;
  compressedSize: number;
  uncompressedSize: number;
  fileNameLength: number;
  extraFieldLength: number;
  fileCommentLength: number;
  externalAttributes: number;
  localHeaderOffset: number;
  fileNameOffset: number;
  nextCursor: number;
}

export interface OpenedZipCentralDirectory {
  view: DataView;
  endRecord: ZipEndOfCentralDirectory;
}

export function isMultiDiskZip(
  endRecord: ZipEndOfCentralDirectory,
): boolean {
  return (
    endRecord.diskNumber !== 0 ||
    endRecord.centralDirectoryDiskNumber !== 0 ||
    endRecord.entriesOnThisDisk !== endRecord.totalEntries
  );
}

export function isZip64EndRecord(
  endRecord: ZipEndOfCentralDirectory,
): boolean {
  return (
    endRecord.entriesOnThisDisk === ZIP64_U16_SENTINEL ||
    endRecord.totalEntries === ZIP64_U16_SENTINEL ||
    endRecord.centralDirectorySize === ZIP64_U32_SENTINEL ||
    endRecord.centralDirectoryOffset === ZIP64_U32_SENTINEL
  );
}

function readUint16LE(view: DataView, offset: number): number {
  return view.getUint16(offset, true);
}

export function readUint32LE(view: DataView, offset: number): number {
  return view.getUint32(offset, true);
}

function findEndOfCentralDirectoryOffset(
  bytes: Uint8Array,
  view: DataView,
): number | null {
  if (bytes.byteLength < ZIP_END_OF_CENTRAL_DIRECTORY_MIN_SIZE) return null;

  const minOffset = Math.max(
    0,
    bytes.byteLength -
      ZIP_MAX_COMMENT_SIZE -
      ZIP_END_OF_CENTRAL_DIRECTORY_MIN_SIZE,
  );
  for (
    let offset = bytes.byteLength - ZIP_END_OF_CENTRAL_DIRECTORY_MIN_SIZE;
    offset >= minOffset;
    offset -= 1
  ) {
    if (
      readUint32LE(view, offset) ===
      ZIP_END_OF_CENTRAL_DIRECTORY_SIGNATURE
    ) {
      return offset;
    }
  }

  return null;
}

export function openZipCentralDirectory(
  bytes: Uint8Array,
): OpenedZipCentralDirectory | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const offset = findEndOfCentralDirectoryOffset(bytes, view);
  if (offset === null) return null;

  return {
    view,
    endRecord: {
      diskNumber: readUint16LE(view, offset + 4),
      centralDirectoryDiskNumber: readUint16LE(view, offset + 6),
      entriesOnThisDisk: readUint16LE(view, offset + 8),
      totalEntries: readUint16LE(view, offset + 10),
      centralDirectorySize: readUint32LE(view, offset + 12),
      centralDirectoryOffset: readUint32LE(view, offset + 16),
    },
  };
}

export function readCentralDirectoryEntryHeader(
  view: DataView,
  cursor: number,
): ZipCentralDirectoryEntryHeader {
  const fileNameLength = readUint16LE(view, cursor + 28);
  const extraFieldLength = readUint16LE(view, cursor + 30);
  const fileCommentLength = readUint16LE(view, cursor + 32);
  const fileNameOffset = cursor + 46;

  return {
    flags: readUint16LE(view, cursor + 8),
    compressedSize: readUint32LE(view, cursor + 20),
    uncompressedSize: readUint32LE(view, cursor + 24),
    fileNameLength,
    extraFieldLength,
    fileCommentLength,
    externalAttributes: readUint32LE(view, cursor + 38),
    localHeaderOffset: readUint32LE(view, cursor + 42),
    fileNameOffset,
    nextCursor:
      fileNameOffset + fileNameLength + extraFieldLength + fileCommentLength,
  };
}

export function isZip64Entry(
  header: ZipCentralDirectoryEntryHeader,
): boolean {
  return (
    header.compressedSize === ZIP64_U32_SENTINEL ||
    header.uncompressedSize === ZIP64_U32_SENTINEL ||
    header.localHeaderOffset === ZIP64_U32_SENTINEL
  );
}

export function isZipSymlink(externalAttributes: number): boolean {
  const posixMode = (externalAttributes >>> 16) & 0xffff;
  return (posixMode & ZIP_FILE_TYPE_MASK) === ZIP_SYMLINK_FILE_TYPE;
}
