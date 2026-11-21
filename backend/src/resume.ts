// A student's résumé: the file they uploaded and the text read out of it for the agents.
// Held in memory with the rest of the student's data, and never written to disk.
import { inflateRawSync } from 'node:zlib';
import { extractText, getDocumentProxy } from 'unpdf';

export const RESUME_MAX_BYTES = 5 * 1024 * 1024;
/** Word (.docx). The older .doc format is not read. */
export const DOCX_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
export const RESUME_TYPES = ['application/pdf', DOCX_TYPE, 'text/plain'];

export interface Resume {
  name: string;
  type: string;
  size: number;
  uploadedAt: string;
  /** Text the agents can read. Null when none could be read from the file. */
  text: string | null;
  bytes: Uint8Array;
}

/** What the page is told about the résumé: everything but the file and its text. */
export type ResumeInfo = Omit<Resume, 'text' | 'bytes'> & { readable: boolean };

export const resumeInfo = (r: Resume | null): ResumeInfo | null =>
  r ? { name: r.name, type: r.type, size: r.size, uploadedAt: r.uploadedAt, readable: r.text !== null } : null;

const tidy = (text: string) => text.replace(/\u0000/g, '').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();

/** Read the text out of an uploaded résumé. A scanned PDF with no text layer gives null. */
export async function readResume(bytes: Uint8Array, type: string): Promise<string | null> {
  try {
    if (type === 'text/plain') return tidy(new TextDecoder().decode(bytes)).slice(0, 20_000) || null;
    if (type === DOCX_TYPE) return tidy(docxText(bytes) ?? '').slice(0, 20_000) || null;
    // unpdf takes ownership of the buffer it is given, so hand it a copy.
    const doc = await getDocumentProxy(bytes.slice());
    const { text } = await extractText(doc, { mergePages: true });
    return tidy(text).slice(0, 20_000) || null;
  } catch {
    return null;
  }
}

/**
 * One file from a ZIP, inflated when the entry is deflated. Enough for a .docx, which is a ZIP
 * of XML. Returns null when the archive or the entry is not one we can read.
 */
export function readZipEntry(bytes: Uint8Array, want: string): Uint8Array | null {
  const buf = Buffer.from(bytes);
  let eocd = -1;
  const scan = Math.min(buf.length, 22 + 0xffff);
  for (let i = buf.length - 22; i >= buf.length - scan; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) return null;
  const count = buf.readUInt16LE(eocd + 10);
  let offset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || offset === 0xffffffff) return null;
  for (let n = 0; n < count && offset + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(offset) !== 0x02014b50) return null;
    const method = buf.readUInt16LE(offset + 10);
    const compSize = buf.readUInt32LE(offset + 20);
    const nameLen = buf.readUInt16LE(offset + 28);
    const extraLen = buf.readUInt16LE(offset + 30);
    const commentLen = buf.readUInt16LE(offset + 32);
    const localOffset = buf.readUInt32LE(offset + 42);
    const name = buf.subarray(offset + 46, offset + 46 + nameLen).toString('utf8');
    if (name === want) {
      if (localOffset + 30 > buf.length) return null;
      const localName = buf.readUInt16LE(localOffset + 26);
      const localExtra = buf.readUInt16LE(localOffset + 28);
      const start = localOffset + 30 + localName + localExtra;
      const data = buf.subarray(start, start + compSize);
      if (data.length < compSize) return null;
      if (method === 0) return new Uint8Array(data);
      if (method === 8) {
        try {
          return new Uint8Array(inflateRawSync(data));
        } catch {
          return null;
        }
      }
      return null;
    }
    offset += 46 + nameLen + extraLen + commentLen;
  }
  return null;
}

const decodeXml = (text: string) =>
  text
    .replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&');

/** Paragraphs of word/document.xml, in order. Drawing and metadata are left out. */
function docxText(bytes: Uint8Array): string | null {
  const xml = readZipEntry(bytes, 'word/document.xml');
  if (!xml) return null;
  const source = new TextDecoder().decode(xml);
  const text = source
    .replace(/<w:tab\b[^/]*\/>/g, '\t')
    .replace(/<w:br\b[^/]*\/>/g, '\n')
    .replace(/<\/w:p>/g, '\n')
    .replace(/<[^>]+>/g, '');
  return decodeXml(text);
}
