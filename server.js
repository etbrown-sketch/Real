import http from 'node:http';
import { promises as fs } from 'node:fs';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import zlib from 'node:zlib';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const HOST_PASSWORD = process.env.HOST_PASSWORD || '123';
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 25);
const MAX_UPLOAD_BYTES = MAX_UPLOAD_MB * 1024 * 1024;
const ACTIVE_STUDENT_WINDOW_MS = 45000;

const PUBLIC_DIR = path.join(__dirname, 'public');
const STORAGE_DIR = path.join(__dirname, 'storage');
const UPLOAD_DIR = path.join(STORAGE_DIR, 'uploads');
const DB_PATH = path.join(STORAGE_DIR, 'db.json');

const activeStudentSessions = new Map();

const DEFAULT_DB = Object.freeze({
  caseStudy: null,
  submissions: [],
  helpQuestions: []
});

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

function sendText(res, statusCode, message) {
  res.writeHead(statusCode, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(message);
}

function getMime(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const types = {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.ico': 'image/x-icon',
    '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.xls': 'application/vnd.ms-excel',
    '.xlsm': 'application/vnd.ms-excel.sheet.macroEnabled.12',
    '.csv': 'text/csv; charset=utf-8',
    '.pdf': 'application/pdf',
    '.doc': 'application/msword',
    '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    '.txt': 'text/plain; charset=utf-8',
    '.rtf': 'application/rtf'
  };
  return types[ext] || 'application/octet-stream';
}

function safeOriginalFilename(filename) {
  const fallback = 'uploaded-file';
  const base = path.basename(String(filename || fallback));
  const cleaned = base.replace(/[^a-zA-Z0-9._ -]/g, '_').replace(/\s+/g, ' ').trim();
  return cleaned || fallback;
}

function uniqueStoredFilename(originalName, prefix = 'file') {
  const safe = safeOriginalFilename(originalName);
  return `${prefix}-${Date.now()}-${crypto.randomUUID()}-${safe}`;
}

async function ensureStorage() {
  await fs.mkdir(UPLOAD_DIR, { recursive: true });
  try {
    await fs.access(DB_PATH);
  } catch {
    await writeDb({ ...DEFAULT_DB });
  }
}

async function readDb() {
  await ensureStorage();
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      caseStudy: parsed.caseStudy || null,
      submissions: Array.isArray(parsed.submissions) ? parsed.submissions : [],
      helpQuestions: Array.isArray(parsed.helpQuestions) ? parsed.helpQuestions : []
    };
  } catch {
    return { ...DEFAULT_DB, submissions: [], helpQuestions: [] };
  }
}

async function writeDb(db) {
  await fs.mkdir(STORAGE_DIR, { recursive: true });
  const tmp = `${DB_PATH}.tmp`;
  await fs.writeFile(tmp, JSON.stringify({
    caseStudy: db.caseStudy || null,
    submissions: Array.isArray(db.submissions) ? db.submissions : [],
    helpQuestions: Array.isArray(db.helpQuestions) ? db.helpQuestions : []
  }, null, 2));
  await fs.rename(tmp, DB_PATH);
}

function pruneActiveStudents(now = Date.now()) {
  for (const [sessionId, lastSeen] of activeStudentSessions.entries()) {
    if (now - lastSeen > ACTIVE_STUDENT_WINDOW_MS) activeStudentSessions.delete(sessionId);
  }
}

function getActiveStudentCount() {
  pruneActiveStudents();
  return activeStudentSessions.size;
}

function updateStudentPresence(sessionId, active) {
  const id = String(sessionId || '').trim();
  if (!id) return getActiveStudentCount();
  if (active) activeStudentSessions.set(id, Date.now());
  else activeStudentSessions.delete(id);
  return getActiveStudentCount();
}

function publicCaseStudy(caseStudy) {
  if (!caseStudy) return null;
  return {
    title: caseStudy.title || 'Turner Finance Futures Program',
    fileName: caseStudy.fileName,
    fileSize: caseStudy.fileSize,
    mimeType: caseStudy.mimeType,
    publishedAt: caseStudy.publishedAt,
    checklist: Array.isArray(caseStudy.checklist) ? caseStudy.checklist : []
  };
}

function parseChecklist(fields) {
  let items = [];

  if (fields.checklistItems) {
    try {
      const parsed = JSON.parse(fields.checklistItems);
      if (Array.isArray(parsed)) items = parsed;
    } catch {
      items = [];
    }
  }

  if (!items.length && fields.checklistText) {
    items = String(fields.checklistText)
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
  }

  return items
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .map((text, index) => ({
      id: `task-${index + 1}-${crypto.randomUUID().slice(0, 8)}`,
      text
    }));
}

async function parseJsonBody(req) {
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > 1024 * 1024) throw Object.assign(new Error('Request body is too large.'), { statusCode: 413 });
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw Object.assign(new Error('Invalid JSON body.'), { statusCode: 400 });
  }
}

function splitBuffer(buffer, delimiter) {
  const pieces = [];
  let start = 0;
  let index = buffer.indexOf(delimiter, start);
  while (index !== -1) {
    pieces.push(buffer.subarray(start, index));
    start = index + delimiter.length;
    index = buffer.indexOf(delimiter, start);
  }
  pieces.push(buffer.subarray(start));
  return pieces;
}

function parseContentDisposition(value) {
  const output = {};
  const parts = String(value || '').split(';').map((part) => part.trim());
  output.type = parts.shift() || '';
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim().toLowerCase();
    let val = part.slice(eq + 1).trim();
    if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
    output[key] = val;
  }
  return output;
}

async function parseMultipart(req) {
  const contentType = req.headers['content-type'] || '';
  const boundaryMatch = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!boundaryMatch) throw Object.assign(new Error('Expected multipart/form-data.'), { statusCode: 400 });

  const boundary = boundaryMatch[1] || boundaryMatch[2];
  const chunks = [];
  let total = 0;
  for await (const chunk of req) {
    total += chunk.length;
    if (total > MAX_UPLOAD_BYTES) {
      throw Object.assign(new Error(`Upload exceeds ${MAX_UPLOAD_MB} MB limit.`), { statusCode: 413 });
    }
    chunks.push(chunk);
  }

  const body = Buffer.concat(chunks);
  const delimiter = Buffer.from(`--${boundary}`);
  const rawParts = splitBuffer(body, delimiter);
  const fields = {};
  const files = {};

  for (let part of rawParts) {
    if (!part.length) continue;
    if (part.subarray(0, 2).toString('latin1') === '\r\n') part = part.subarray(2);
    if (part.subarray(0, 2).toString('latin1') === '--') continue;
    if (part.subarray(part.length - 2).toString('latin1') === '\r\n') part = part.subarray(0, part.length - 2);

    const headerEnd = part.indexOf(Buffer.from('\r\n\r\n'));
    if (headerEnd === -1) continue;

    const headerText = part.subarray(0, headerEnd).toString('latin1');
    const content = part.subarray(headerEnd + 4);
    const headers = {};
    for (const line of headerText.split('\r\n')) {
      const colon = line.indexOf(':');
      if (colon === -1) continue;
      headers[line.slice(0, colon).trim().toLowerCase()] = line.slice(colon + 1).trim();
    }

    const disposition = parseContentDisposition(headers['content-disposition']);
    const name = disposition.name;
    if (!name) continue;

    if (Object.prototype.hasOwnProperty.call(disposition, 'filename')) {
      if (!disposition.filename) continue;
      files[name] = {
        filename: safeOriginalFilename(disposition.filename),
        mimeType: headers['content-type'] || 'application/octet-stream',
        size: content.length,
        buffer: Buffer.from(content)
      };
    } else {
      fields[name] = content.toString('utf8');
    }
  }

  return { fields, files };
}

function isHostRequest(req, searchParams) {
  const headerPassword = req.headers['x-host-password'];
  const queryPassword = searchParams.get('password');
  return headerPassword === HOST_PASSWORD || queryPassword === HOST_PASSWORD;
}

function classifyPrompt(message) {
  const text = String(message || '').trim().toLowerCase();
  if (!text) return 'empty';

  const locationPattern = /\b(where|find|locate|which tab|which sheet|source|look for|where should i start|what should i check)\b/i;
  const debuggingPattern = /\b(stuck|error|wrong|debug|not working|#ref|#value|#n\/a|broken|circular reference|formula error)\b/i;
  const conceptPattern = /\b(explain|understand|formula|method|approach|ratio|margin|variance|forecast|budget|cash flow|working capital|revenue|expense|ebitda|depreciation|capex|assumption)\b/i;
  const planningPattern = /\b(plan|steps|sequence|prioritize|next|review|checklist|rubric|organize)\b/i;
  const directAnswerPattern = /\b(just\s+)?(give|tell|send|provide)\s+(me\s+)?(the\s+)?(answer|answers|final|number|result|solution)\b|\b(do|complete|fill\s+out|solve|calculate|build|make)\s+(it|this|the\s+case|the\s+workbook|the\s+model|the\s+excel|the\s+spreadsheet|for\s+me)\b|\bwhat\s+(is|are)\s+(the\s+)?(answer|answers|final|exact)\b|\bcopy\s*[- ]?paste\b/i;

  if (directAnswerPattern.test(text)) return 'answer-seeking';
  if (locationPattern.test(text)) return 'location-guidance';
  if (debuggingPattern.test(text)) return 'debugging';
  if (conceptPattern.test(text)) return 'conceptual-help';
  if (planningPattern.test(text)) return 'planning';
  if (text.length < 24) return 'vague';
  return 'general-coaching';
}

function summarizeChecklist(checklist, completedIds) {
  const completed = new Set(Array.isArray(completedIds) ? completedIds : []);
  const nextTask = (checklist || []).find((task) => !completed.has(task.id));
  const completedCount = (checklist || []).filter((task) => completed.has(task.id)).length;
  return {
    nextTask,
    completedCount,
    totalCount: Array.isArray(checklist) ? checklist.length : 0
  };
}

function generateAiBossReply({ message, checklist = [], completedIds = [] }) {
  const category = classifyPrompt(message);
  const { nextTask, completedCount, totalCount } = summarizeChecklist(checklist, completedIds);
  const progressLine = totalCount
    ? `You have marked ${completedCount} of ${totalCount} checklist items complete.`
    : 'Use the host checklist as your roadmap once it is available.';
  const nextLine = nextTask ? `A useful next checkpoint is: "${nextTask.text}".` : 'You appear to have marked every checklist item complete; now audit your work before submitting.';

  let reply;
  switch (category) {
    case 'answer-seeking':
      reply = `I cannot provide final answers, exact values, or fill out the workbook for you. ${progressLine} ${nextLine} Tell me what sheet, cell range, or assumption you are reviewing and what you have already tried; I can help you choose the next check.`;
      break;
    case 'location-guidance':
      reply = `Start by matching the wording of the checklist item to the workbook tabs and any assumption or source-data sections. ${nextLine} Look for labels, dates, units, and subtotals before building formulas. I can help you narrow the search if you describe the tabs you see.`;
      break;
    case 'debugging':
      reply = `Good debugging request. Do not change numbers yet. First check that the formula points to the intended range, uses consistent time periods, and handles signs correctly for revenue, expenses, assets, and liabilities. ${nextLine} Share the structure of your formula without asking me to compute the final value.`;
      break;
    case 'conceptual-help':
      reply = `Here is the method without doing the work: identify the driver, confirm the unit, select the matching source data, then build a formula that can be copied across periods. ${nextLine} After that, sanity-check the direction and magnitude against the case context.`;
      break;
    case 'planning':
      reply = `Use this sequence: read the instructions, identify required outputs, map each output to the workbook source tabs, complete one checklist item at a time, then review formulas and assumptions. ${progressLine} ${nextLine}`;
      break;
    case 'vague':
      reply = `I need a more specific coaching question. Try: "I am on checklist item X, I found Y on tab Z, and I think the next step is..." ${nextLine}`;
      break;
    case 'empty':
      reply = 'Type a coaching question and I will guide your next step without giving final answers.';
      break;
    default:
      reply = `I can coach your process, point you toward source information, and help you verify your reasoning. ${progressLine} ${nextLine} Ask for hints, checks, or concepts rather than final answers.`;
  }

  return { category, reply };
}

function countBy(items, keyFn) {
  const counts = {};
  for (const item of items) {
    const key = keyFn(item);
    counts[key] = (counts[key] || 0) + 1;
  }
  return counts;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function letterFromScore(score) {
  if (score >= 90) return 'A';
  if (score >= 80) return 'B';
  if (score >= 70) return 'C';
  if (score >= 60) return 'D';
  return 'F';
}

function generateAssignmentGrade({ progressPercent, totalPrompts, productiveRatio, directCount, directRatio, vagueCount }) {
  const checklistComponent = progressPercent * 0.78;
  const coachingComponent = totalPrompts ? productiveRatio * 22 : 12;
  const answerSeekingPenalty = Math.min(22, directCount * 7 + directRatio * 8);
  const vaguePenalty = Math.min(8, vagueCount * 2);
  const score = clamp(Math.round(checklistComponent + coachingComponent - answerSeekingPenalty - vaguePenalty), 0, 100);
  const letter = letterFromScore(score);

  let rationale = `${progressPercent}% checklist completion with ${totalPrompts} AI Boss prompt${totalPrompts === 1 ? '' : 's'}.`;
  if (directCount > 0) rationale += ` Penalized for ${directCount} answer-seeking prompt${directCount === 1 ? '' : 's'}.`;
  else if (totalPrompts > 0) rationale += ' AI Boss use was primarily coaching-oriented.';
  else rationale += ' No AI Boss interaction was logged.';

  return {
    letter,
    score,
    rationale,
    confidenceNote: 'Grade is based on checklist completion and AI Boss interaction behavior; it does not inspect the contents of the uploaded workbook.'
  };
}

function generateSubmissionReport({ studentName, checklist = [], completedIds = [], interactions = [] }) {
  const completedSet = new Set(Array.isArray(completedIds) ? completedIds : []);
  const totalChecklist = checklist.length;
  const completedCount = checklist.filter((task) => completedSet.has(task.id)).length;
  const progressPercent = totalChecklist ? Math.round((completedCount / totalChecklist) * 100) : 0;

  const studentMessages = interactions.filter((entry) => entry && entry.role === 'student');
  const categories = countBy(studentMessages, (entry) => entry.category || classifyPrompt(entry.text));
  const totalPrompts = studentMessages.length;
  const directCount = categories['answer-seeking'] || 0;
  const productiveCount = (categories['location-guidance'] || 0) + (categories['conceptual-help'] || 0) + (categories.debugging || 0) + (categories.planning || 0) + (categories['general-coaching'] || 0);
  const vagueCount = categories.vague || 0;
  const directRatio = totalPrompts ? directCount / totalPrompts : 0;
  const productiveRatio = totalPrompts ? productiveCount / totalPrompts : 0;
  const grade = generateAssignmentGrade({ progressPercent, totalPrompts, productiveRatio, directCount, directRatio, vagueCount });

  let rating = 'Productive coaching use';
  let risk = 'Low';
  let pattern = 'The student generally used the AI Boss for process guidance, concept clarification, or debugging rather than final answers.';
  let hostFollowUp = 'Compare workbook quality against the checklist and ask the student to explain one key assumption.';

  if (totalPrompts === 0) {
    rating = 'No AI interaction logged';
    risk = 'Unknown';
    pattern = 'The student submitted without using the AI Boss in this session.';
    hostFollowUp = 'Review the workbook directly and ask how the student approached the case.';
  } else if (directCount >= 3 || directRatio >= 0.34) {
    rating = 'High dependency risk';
    risk = 'High';
    pattern = 'The student repeatedly asked for final answers, exact values, or for the AI Boss to complete work. The AI Boss redirected those requests.';
    hostFollowUp = 'Ask the student to walk through their reasoning and verify that they can reproduce the work independently.';
  } else if (directCount > 0 || vagueCount >= Math.max(2, Math.ceil(totalPrompts / 3))) {
    rating = 'Needs more precise coaching habits';
    risk = 'Moderate';
    pattern = 'The student had some answer-seeking or vague prompts, but also used coaching prompts that can support learning.';
    hostFollowUp = 'Coach the student to ask for source-location help, formula checks, and reasoning validation instead of broad hints.';
  } else if (progressPercent < 70) {
    rating = 'Under-completed checklist';
    risk = 'Moderate';
    pattern = 'The AI interaction pattern looked appropriate, but the submitted checklist progress was incomplete.';
    hostFollowUp = 'Review missing checklist items before comparing this submission with fully completed cases.';
  } else if (productiveRatio >= 0.75 && progressPercent >= 90) {
    rating = 'Strong independent use';
    risk = 'Low';
    pattern = 'The student used the AI Boss mostly for source-finding, planning, conceptual explanation, or debugging while completing most checklist items.';
    hostFollowUp = 'Use this submission as a candidate for deeper content review and peer comparison.';
  }

  return {
    rating,
    risk,
    grade,
    pattern,
    hostFollowUp,
    stats: {
      totalPrompts,
      answerSeekingPrompts: directCount,
      productiveCoachingPrompts: productiveCount,
      vaguePrompts: vagueCount,
      progressPercent,
      completedChecklistItems: completedCount,
      totalChecklistItems: totalChecklist
    },
    shortComparisonLine: `${studentName || 'Student'}: ${grade.letter} (${grade.score}); ${rating}; ${progressPercent}% checklist completion; ${directCount}/${totalPrompts} answer-seeking prompts.`
  };
}

function decodeXmlEntities(text) {
  return String(text || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function readUInt32LE(buffer, offset) {
  if (offset + 4 > buffer.length) return 0;
  return buffer.readUInt32LE(offset);
}

function readUInt16LE(buffer, offset) {
  if (offset + 2 > buffer.length) return 0;
  return buffer.readUInt16LE(offset);
}

function inflateZipEntry(buffer, entry) {
  const localOffset = entry.localHeaderOffset;
  if (readUInt32LE(buffer, localOffset) !== 0x04034b50) return null;
  const nameLength = readUInt16LE(buffer, localOffset + 26);
  const extraLength = readUInt16LE(buffer, localOffset + 28);
  const dataStart = localOffset + 30 + nameLength + extraLength;
  const dataEnd = dataStart + entry.compressedSize;
  if (dataStart < 0 || dataEnd > buffer.length) return null;
  const compressed = buffer.subarray(dataStart, dataEnd);
  if (entry.compressionMethod === 0) return compressed;
  if (entry.compressionMethod === 8) return zlib.inflateRawSync(compressed);
  return null;
}

function parseZipEntries(buffer) {
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  const minOffset = Math.max(0, buffer.length - 65558);
  for (let index = buffer.length - 22; index >= minOffset; index -= 1) {
    if (readUInt32LE(buffer, index) === eocdSignature) {
      eocdOffset = index;
      break;
    }
  }
  if (eocdOffset === -1) return [];

  const entryCount = readUInt16LE(buffer, eocdOffset + 10);
  const centralDirectoryOffset = readUInt32LE(buffer, eocdOffset + 16);
  const entries = [];
  let offset = centralDirectoryOffset;

  for (let index = 0; index < entryCount; index += 1) {
    if (readUInt32LE(buffer, offset) !== 0x02014b50) break;
    const compressionMethod = readUInt16LE(buffer, offset + 10);
    const compressedSize = readUInt32LE(buffer, offset + 20);
    const nameLength = readUInt16LE(buffer, offset + 28);
    const extraLength = readUInt16LE(buffer, offset + 30);
    const commentLength = readUInt16LE(buffer, offset + 32);
    const localHeaderOffset = readUInt32LE(buffer, offset + 42);
    const nameStart = offset + 46;
    const nameEnd = nameStart + nameLength;
    if (nameEnd > buffer.length) break;
    const name = buffer.subarray(nameStart, nameEnd).toString('utf8');
    entries.push({ name, compressionMethod, compressedSize, localHeaderOffset });
    offset = nameEnd + extraLength + commentLength;
  }

  return entries;
}

function extractDocxText(buffer) {
  try {
    const entries = parseZipEntries(buffer);
    const xmlEntries = entries.filter((entry) => /^word\/(document|header\d+|footer\d+)\.xml$/i.test(entry.name));
    const pieces = [];
    for (const entry of xmlEntries) {
      const inflated = inflateZipEntry(buffer, entry);
      if (!inflated) continue;
      const xml = inflated.toString('utf8');
      const withBreaks = xml.replace(/<w:(p|br|tab)[^>]*>/g, '\n');
      const text = decodeXmlEntities(withBreaks.replace(/<[^>]+>/g, ' '));
      pieces.push(text);
    }
    return pieces.join('\n');
  } catch {
    return '';
  }
}

function decodePdfLiteral(literal) {
  return literal
    .slice(1, -1)
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\n')
    .replace(/\\t/g, ' ')
    .replace(/\\\(/g, '(')
    .replace(/\\\)/g, ')')
    .replace(/\\\\/g, '\\');
}

function extractPdfText(buffer) {
  try {
    const latin = buffer.toString('latin1');
    const pieces = [];
    const literalPattern = /\((?:\\.|[^\\)]){2,}\)/g;
    for (const match of latin.matchAll(literalPattern)) {
      const decoded = decodePdfLiteral(match[0]);
      if (/[a-zA-Z]{3,}/.test(decoded)) pieces.push(decoded);
      if (pieces.join(' ').length > 30000) break;
    }

    const streamPattern = /<<(?:.|\n|\r){0,1200}\/Filter\s*\/FlateDecode(?:.|\n|\r){0,1200}>>\s*stream\r?\n/g;
    for (const streamMatch of latin.matchAll(streamPattern)) {
      const streamStart = streamMatch.index + streamMatch[0].length;
      const endIndex = latin.indexOf('endstream', streamStart);
      if (endIndex === -1) continue;
      let streamBuffer = buffer.subarray(streamStart, endIndex);
      while (streamBuffer.length && (streamBuffer[0] === 0x0a || streamBuffer[0] === 0x0d)) streamBuffer = streamBuffer.subarray(1);
      while (streamBuffer.length && (streamBuffer[streamBuffer.length - 1] === 0x0a || streamBuffer[streamBuffer.length - 1] === 0x0d)) streamBuffer = streamBuffer.subarray(0, streamBuffer.length - 1);
      try {
        const inflated = zlib.inflateSync(streamBuffer).toString('latin1');
        for (const textMatch of inflated.matchAll(literalPattern)) {
          const decoded = decodePdfLiteral(textMatch[0]);
          if (/[a-zA-Z]{3,}/.test(decoded)) pieces.push(decoded);
        }
      } catch {
        // Continue with other streams.
      }
      if (pieces.join(' ').length > 30000) break;
    }

    return pieces.join('\n');
  } catch {
    return '';
  }
}

function stripRtf(text) {
  return String(text || '')
    .replace(/\\'[0-9a-fA-F]{2}/g, ' ')
    .replace(/\\[a-zA-Z]+-?\d* ?/g, ' ')
    .replace(/[{}]/g, ' ');
}

function cleanExtractedText(text) {
  return String(text || '')
    .replace(/\u0000/g, ' ')
    .replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x7f]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 60000);
}

function extractResumeText(file) {
  const ext = path.extname(file.filename || '').toLowerCase();
  let text = '';
  if (ext === '.docx') text = extractDocxText(file.buffer);
  else if (ext === '.pdf') text = extractPdfText(file.buffer);
  else if (ext === '.rtf') text = stripRtf(file.buffer.toString('utf8'));
  else text = file.buffer.toString('utf8');

  if (!text || text.length < 40) {
    const fallback = file.buffer.toString('latin1').replace(/[^\x09\x0a\x0d\x20-\x7e]+/g, ' ');
    if (fallback.length > text.length) text = fallback;
  }
  return cleanExtractedText(text);
}

const monthMap = new Map([
  ['jan', 0], ['january', 0], ['feb', 1], ['february', 1], ['mar', 2], ['march', 2], ['apr', 3], ['april', 3],
  ['may', 4], ['jun', 5], ['june', 5], ['jul', 6], ['july', 6], ['aug', 7], ['august', 7], ['sep', 8],
  ['sept', 8], ['september', 8], ['oct', 9], ['october', 9], ['nov', 10], ['november', 10], ['dec', 11], ['december', 11]
]);

function parseMonthYear(value, isEndDate = false) {
  const text = String(value || '').toLowerCase().replace(/\./g, '').trim();
  if (/present|current|now/.test(text)) {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  }

  const monthYear = text.match(/\b(january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec)\s+(20\d{2}|19\d{2})\b/);
  if (monthYear) return Number(monthYear[2]) * 12 + monthMap.get(monthYear[1]);

  const numeric = text.match(/\b(\d{1,2})\/(20\d{2}|19\d{2})\b/);
  if (numeric) return Number(numeric[2]) * 12 + clamp(Number(numeric[1]) - 1, 0, 11);

  const yearOnly = text.match(/\b(20\d{2}|19\d{2})\b/);
  if (yearOnly) return Number(yearOnly[1]) * 12 + (isEndDate ? 11 : 0);

  return null;
}

function estimateYearsExperience(text) {
  const normalized = String(text || '').replace(/[–—]/g, '-');
  const explicitMatches = [...normalized.matchAll(/\b(\d+(?:\.\d+)?)\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:professional\s+)?(?:experience|work)\b/gi)]
    .map((match) => Number(match[1]))
    .filter((value) => Number.isFinite(value) && value >= 0);
  const explicitMax = explicitMatches.length ? Math.max(...explicitMatches) : null;

  const monthNames = 'january|february|march|april|may|june|july|august|september|sept|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|oct|nov|dec';
  const dateToken = `(?:${monthNames})\\.?\\s+(?:20\\d{2}|19\\d{2})|(?:\\d{1,2}\\/(?:20\\d{2}|19\\d{2}))|(?:20\\d{2}|19\\d{2})|present|current|now`;
  const rangeRegex = new RegExp(`(${dateToken})\\s*(?:-|to)\\s*(${dateToken})`, 'gi');
  const seen = new Set();
  let totalMonths = 0;

  for (const match of normalized.matchAll(rangeRegex)) {
    const key = match[0].toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const start = parseMonthYear(match[1], false);
    const end = parseMonthYear(match[2], true);
    if (start === null || end === null || end < start) continue;
    const months = clamp(end - start + 1, 0, 240);
    totalMonths += months;
  }

  const rangeYears = totalMonths ? Math.round((totalMonths / 12) * 10) / 10 : null;
  const final = Math.max(explicitMax || 0, rangeYears || 0);
  return final > 0 ? clamp(final, 0, 40) : null;
}

function estimateInternshipCount(text) {
  const normalized = String(text || '');
  if (!normalized.trim()) return null;
  const lines = normalized
    .split(/\n|\r|\||;|\u2022|\u25cf/g)
    .map((line) => line.trim())
    .filter(Boolean);
  const internLineSet = new Set();
  for (const line of lines) {
    if (/\b(intern|internship|externship|co-op|co op|summer analyst)\b/i.test(line)) {
      internLineSet.add(line.toLowerCase().slice(0, 140));
    }
  }
  const occurrenceCount = (normalized.match(/\b(intern|internship|externship|co-op|co op|summer analyst)\b/gi) || []).length;
  if (internLineSet.size) return clamp(Math.max(internLineSet.size, occurrenceCount), 0, 20);
  return occurrenceCount ? clamp(occurrenceCount, 0, 20) : 0;
}

function detectIndustryBreakdown(text) {
  const lower = String(text || '').toLowerCase();
  if (!lower.trim()) return '';
  const industries = [
    ['Construction', ['construction', 'general contractor', 'subcontractor', 'project engineer', 'site safety', 'concrete', 'bim', 'revit', 'civil']],
    ['Finance And Accounting', ['finance', 'financial', 'accounting', 'audit', 'valuation', 'investment', 'forecast', 'budget', 'fp&a', 'analyst']],
    ['Real Estate And Development', ['real estate', 'development', 'property', 'leasing', 'facilities', 'asset management']],
    ['Consulting', ['consulting', 'consultant', 'advisory', 'client engagement', 'strategy']],
    ['Technology And Data', ['software', 'data', 'analytics', 'sql', 'python', 'power bi', 'tableau', 'database']],
    ['Operations And Supply Chain', ['operations', 'supply chain', 'logistics', 'procurement', 'inventory', 'vendor']],
    ['Engineering And Architecture', ['engineering', 'engineer', 'architecture', 'architect', 'design', 'cad', 'autocad']],
    ['Healthcare', ['healthcare', 'hospital', 'clinic', 'patient', 'medical']],
    ['Education', ['teaching', 'tutor', 'education', 'university', 'student affairs']],
    ['Retail And Hospitality', ['retail', 'restaurant', 'hospitality', 'customer service', 'sales associate']],
    ['Government And Nonprofit', ['government', 'nonprofit', 'non-profit', 'public sector', 'community organization']]
  ];

  const scores = industries.map(([name, keywords]) => {
    let score = 0;
    for (const keyword of keywords) {
      const escaped = keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const matches = lower.match(new RegExp(`\\b${escaped}\\b`, 'g'));
      if (matches) score += matches.length;
    }
    return { name, score };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score);

  if (!scores.length) return '';
  const total = scores.reduce((sum, item) => sum + item.score, 0);
  return scores.slice(0, 5).map((item) => {
    const percent = total ? Math.round((item.score / total) * 100) : 0;
    return `${item.name}: ${percent}% signal`;
  }).join('; ');
}

function parseOptionalNumber(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  const number = Number(text);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.round(number * 10) / 10;
}

function buildResumeProfile(file, fields) {
  const resumeText = extractResumeText(file);
  const detectedInternshipCount = estimateInternshipCount(resumeText);
  const detectedYearsExperience = estimateYearsExperience(resumeText);
  const detectedIndustryBreakdown = detectIndustryBreakdown(resumeText);

  const providedInternshipCount = parseOptionalNumber(fields.resumeInternshipCount);
  const providedYearsExperience = parseOptionalNumber(fields.resumeYearsExperience);
  const providedIndustryBreakdown = String(fields.resumeIndustryBreakdown || '').trim();

  const internshipCount = providedInternshipCount ?? detectedInternshipCount;
  const yearsExperience = providedYearsExperience ?? detectedYearsExperience;
  const industryBreakdown = providedIndustryBreakdown || detectedIndustryBreakdown;
  const extractedTextLength = resumeText.length;
  const usedStudentProvided = providedInternshipCount !== null || providedYearsExperience !== null || Boolean(providedIndustryBreakdown);

  let confidenceNote = 'Resume dashboard data combines student-entered resume details with a best-effort scan of the uploaded resume.';
  if (!extractedTextLength || extractedTextLength < 100) {
    confidenceNote = 'The uploaded resume was not text-readable in this no-dependency build. Review the resume manually if student-entered resume details are missing.';
  } else if (!usedStudentProvided) {
    confidenceNote = 'Values were estimated from readable resume text. Review the resume manually before making final decisions.';
  }

  return {
    internshipCount,
    yearsExperience,
    industryBreakdown: industryBreakdown || '',
    source: usedStudentProvided ? 'Student Details And Resume Scan' : 'Resume Scan',
    confidenceNote,
    extractedTextLength,
    detected: {
      internshipCount: detectedInternshipCount,
      yearsExperience: detectedYearsExperience,
      industryBreakdown: detectedIndustryBreakdown || ''
    },
    studentProvided: {
      internshipCount: providedInternshipCount,
      yearsExperience: providedYearsExperience,
      industryBreakdown: providedIndustryBreakdown
    }
  };
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function submissionsToCsv(submissions) {
  const headers = [
    'Student',
    'Email Address',
    'College',
    'Expected Graduation Date',
    'Major',
    'Submitted At',
    'Case File Name',
    'Resume File Name',
    'Number Of Internships On Resume',
    'Years Of Experience On Resume',
    'Industry Experience Breakdown',
    'Resume Insight Confidence Note',
    'Checklist Progress',
    'AI Grade Letter',
    'AI Grade Score',
    'Grade Rationale',
    'Grade Confidence Note',
    'AI Rating',
    'Risk',
    'Total Prompts',
    'Answer Seeking Prompts',
    'Productive Coaching Prompts',
    'Summary',
    'Host Follow Up'
  ];
  const rows = submissions.map((submission) => {
    const stats = submission.report?.stats || {};
    const grade = submission.report?.grade || {};
    const resumeProfile = submission.resumeProfile || {};
    return [
      submission.studentName,
      submission.studentEmail || '',
      submission.college || '',
      submission.expectedGraduationDate || '',
      submission.major || '',
      submission.submittedAt,
      submission.fileName,
      submission.resumeFileName || '',
      resumeProfile.internshipCount ?? '',
      resumeProfile.yearsExperience ?? '',
      resumeProfile.industryBreakdown || '',
      resumeProfile.confidenceNote || '',
      `${stats.progressPercent ?? 0}%`,
      grade.letter || '',
      grade.score ?? '',
      grade.rationale || '',
      grade.confidenceNote || '',
      submission.report?.rating || '',
      submission.report?.risk || '',
      stats.totalPrompts ?? 0,
      stats.answerSeekingPrompts ?? 0,
      stats.productiveCoachingPrompts ?? 0,
      submission.report?.pattern || '',
      submission.report?.hostFollowUp || ''
    ];
  });
  return [headers, ...rows].map((row) => row.map(csvEscape).join(',')).join('\n');
}

async function saveUploadedFile(file, prefix) {
  const storedName = uniqueStoredFilename(file.filename, prefix);
  const storedPath = path.join(UPLOAD_DIR, storedName);
  await fs.writeFile(storedPath, file.buffer);
  return {
    storedName,
    storedPath,
    fileName: file.filename,
    mimeType: file.mimeType || getMime(file.filename),
    fileSize: file.size
  };
}

async function serveStatic(req, res, pathname) {
  let requested = decodeURIComponent(pathname);
  if (requested === '/') requested = '/index.html';
  const resolved = path.resolve(PUBLIC_DIR, `.${requested}`);
  if (!resolved.startsWith(PUBLIC_DIR)) return sendText(res, 403, 'Forbidden');

  try {
    const stat = await fs.stat(resolved);
    if (!stat.isFile()) return sendText(res, 404, 'Not found');
    res.writeHead(200, {
      'Content-Type': getMime(resolved),
      'Content-Length': stat.size,
      'Cache-Control': 'no-store'
    });
    createReadStream(resolved).pipe(res);
  } catch {
    sendText(res, 404, 'Not found');
  }
}

async function streamStoredFile(res, storedName, originalName, mimeType) {
  const resolved = path.resolve(UPLOAD_DIR, storedName);
  if (!resolved.startsWith(UPLOAD_DIR)) return sendText(res, 403, 'Forbidden');
  try {
    const stat = await fs.stat(resolved);
    res.writeHead(200, {
      'Content-Type': mimeType || getMime(originalName),
      'Content-Length': stat.size,
      'Content-Disposition': `attachment; filename="${safeOriginalFilename(originalName).replace(/"/g, '')}"`,
      'Cache-Control': 'no-store'
    });
    createReadStream(resolved).pipe(res);
  } catch {
    sendText(res, 404, 'File not found');
  }
}

function validateExtension(file, allowedExtensions, message) {
  if (!allowedExtensions.has(path.extname(file.filename).toLowerCase())) {
    throw Object.assign(new Error(message), { statusCode: 400 });
  }
}

function findSubmissionById(db, pathname) {
  const id = pathname.split('/').pop();
  return db.submissions.find((item) => item.id === id);
}

function validEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function publicQuestion(question) {
  return {
    id: question.id,
    casePublishedAt: question.casePublishedAt || '',
    studentName: question.studentName || '',
    studentEmail: question.studentEmail || '',
    question: question.question || '',
    answer: question.answer || '',
    status: question.status || (question.answer ? 'Answered' : 'Open'),
    createdAt: question.createdAt || '',
    answeredAt: question.answeredAt || ''
  };
}

function publicSubmissionSummary(submission) {
  return {
    id: submission.id,
    studentName: submission.studentName,
    studentEmail: submission.studentEmail || '',
    college: submission.college || '',
    expectedGraduationDate: submission.expectedGraduationDate || '',
    major: submission.major || '',
    submittedAt: submission.submittedAt,
    fileName: submission.fileName,
    fileSize: submission.fileSize,
    resumeFileName: submission.resumeFileName || '',
    resumeFileSize: submission.resumeFileSize || 0,
    resumeProfile: submission.resumeProfile || {},
    report: submission.report,
    interactionCount: Array.isArray(submission.interactions) ? submission.interactions.length : 0
  };
}

async function handleApi(req, res, pathname, searchParams) {
  if (req.method === 'GET' && pathname === '/api/status') {
    const db = await readDb();
    return sendJson(res, 200, {
      caseStudy: publicCaseStudy(db.caseStudy),
      submissionCount: db.submissions.length,
      activeStudentCount: getActiveStudentCount()
    });
  }

  if (req.method === 'POST' && pathname === '/api/student-presence') {
    const body = await parseJsonBody(req);
    const activeStudentCount = updateStudentPresence(body.sessionId, body.active);
    return sendJson(res, 200, { ok: true, activeStudentCount });
  }

  if (req.method === 'POST' && pathname === '/api/host/login') {
    const body = await parseJsonBody(req);
    if (body.password === HOST_PASSWORD) return sendJson(res, 200, { ok: true });
    return sendJson(res, 401, { ok: false, error: 'Incorrect password.' });
  }

  if (req.method === 'GET' && pathname === '/api/case-file') {
    const db = await readDb();
    if (!db.caseStudy) return sendText(res, 404, 'No case study has been published.');
    return streamStoredFile(res, db.caseStudy.storedName, db.caseStudy.fileName, db.caseStudy.mimeType);
  }

  if (req.method === 'POST' && pathname === '/api/ai-boss') {
    const db = await readDb();
    if (!db.caseStudy) return sendJson(res, 409, { error: 'No case study is published yet.' });
    const body = await parseJsonBody(req);
    const result = generateAiBossReply({
      message: body.message,
      checklist: db.caseStudy.checklist || [],
      completedIds: Array.isArray(body.completedIds) ? body.completedIds : []
    });
    return sendJson(res, 200, result);
  }

  if (req.method === 'GET' && pathname === '/api/help/questions') {
    const db = await readDb();
    const sessionId = String(searchParams.get('sessionId') || '').trim();
    if (!sessionId) return sendJson(res, 400, { error: 'Student session is required.' });
    const currentCasePublishedAt = db.caseStudy?.publishedAt || '';
    const questions = db.helpQuestions
      .filter((question) => question.sessionId === sessionId && (!currentCasePublishedAt || question.casePublishedAt === currentCasePublishedAt))
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(publicQuestion);
    return sendJson(res, 200, { questions });
  }

  if (req.method === 'POST' && pathname === '/api/help/questions') {
    const db = await readDb();
    if (!db.caseStudy) return sendJson(res, 409, { error: 'No case study is published yet.' });
    const body = await parseJsonBody(req);
    const sessionId = String(body.sessionId || '').trim();
    const studentName = String(body.studentName || '').trim();
    const studentEmail = String(body.studentEmail || '').trim();
    const questionText = String(body.question || '').trim();

    if (!sessionId) return sendJson(res, 400, { error: 'Student session is required.' });
    if (!studentName) return sendJson(res, 400, { error: 'Student name is required.' });
    if (!validEmail(studentEmail)) return sendJson(res, 400, { error: 'Enter a valid email address.' });
    if (questionText.length < 5) return sendJson(res, 400, { error: 'Enter a question for the host.' });

    const question = {
      id: crypto.randomUUID(),
      casePublishedAt: db.caseStudy.publishedAt,
      sessionId,
      studentName,
      studentEmail,
      question: questionText,
      status: 'Open',
      answer: '',
      createdAt: new Date().toISOString(),
      answeredAt: ''
    };
    db.helpQuestions.unshift(question);
    await writeDb(db);
    return sendJson(res, 200, { ok: true, question: publicQuestion(question) });
  }

  if (req.method === 'GET' && pathname === '/api/host/questions') {
    if (!isHostRequest(req, searchParams)) return sendJson(res, 401, { error: 'Host password required.' });
    const db = await readDb();
    const questions = db.helpQuestions
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      .map(publicQuestion);
    return sendJson(res, 200, { questions });
  }

  if (req.method === 'POST' && pathname.startsWith('/api/host/questions/') && pathname.endsWith('/answer')) {
    if (!isHostRequest(req, searchParams)) return sendJson(res, 401, { error: 'Host password required.' });
    const questionId = pathname.split('/').at(-2);
    const db = await readDb();
    const question = db.helpQuestions.find((item) => item.id === questionId);
    if (!question) return sendJson(res, 404, { error: 'Question not found.' });
    const body = await parseJsonBody(req);
    const answer = String(body.answer || '').trim();
    if (!answer) return sendJson(res, 400, { error: 'Enter an answer before posting.' });
    question.answer = answer;
    question.status = 'Answered';
    question.answeredAt = new Date().toISOString();
    await writeDb(db);
    return sendJson(res, 200, { ok: true, question: publicQuestion(question) });
  }

  if (req.method === 'POST' && pathname === '/api/host/publish') {
    if (!isHostRequest(req, searchParams)) return sendJson(res, 401, { error: 'Host password required.' });
    const { fields, files } = await parseMultipart(req);
    const caseFile = files.caseFile;
    const title = String(fields.caseTitle || '').trim();
    if (!title) return sendJson(res, 400, { error: 'Add a case title before publishing.' });
    if (!caseFile) return sendJson(res, 400, { error: 'Upload an Excel case document.' });

    validateExtension(caseFile, new Set(['.xlsx', '.xls', '.xlsm', '.csv']), 'Case document must be .xlsx, .xls, .xlsm, or .csv.');

    const checklist = parseChecklist(fields);
    if (!checklist.length) return sendJson(res, 400, { error: 'Add at least one checklist instruction.' });

    const saved = await saveUploadedFile(caseFile, 'case');
    const db = await readDb();
    db.caseStudy = {
      ...saved,
      title,
      publishedAt: new Date().toISOString(),
      checklist
    };

    if (fields.clearSubmissions === 'true') {
      db.submissions = [];
      db.helpQuestions = [];
    }

    await writeDb(db);
    return sendJson(res, 200, { ok: true, caseStudy: publicCaseStudy(db.caseStudy) });
  }

  if (req.method === 'POST' && pathname === '/api/submissions') {
    const db = await readDb();
    if (!db.caseStudy) return sendJson(res, 409, { error: 'No case study is published yet.' });

    const { fields, files } = await parseMultipart(req);
    const submissionFile = files.submissionFile;
    const resumeFile = files.resumeFile;
    const studentName = String(fields.studentName || '').trim();
    const studentEmail = String(fields.studentEmail || '').trim();
    const college = String(fields.studentCollege || fields.college || '').trim();
    const expectedGraduationDate = String(fields.expectedGraduationDate || '').trim();
    const major = String(fields.studentMajor || fields.major || '').trim();

    if (!studentName) return sendJson(res, 400, { error: 'Student name is required.' });
    if (!validEmail(studentEmail)) return sendJson(res, 400, { error: 'Enter a valid email address.' });
    if (!college) return sendJson(res, 400, { error: 'College is required.' });
    if (!expectedGraduationDate) return sendJson(res, 400, { error: 'Expected graduation date is required.' });
    if (!major) return sendJson(res, 400, { error: 'Major is required.' });
    if (!submissionFile) return sendJson(res, 400, { error: 'Upload your completed case study document.' });
    if (!resumeFile) return sendJson(res, 400, { error: 'Attach your resume before submitting.' });

    validateExtension(submissionFile, new Set(['.xlsx', '.xls', '.xlsm', '.csv']), 'Completed case study document must be .xlsx, .xls, .xlsm, or .csv.');
    validateExtension(resumeFile, new Set(['.pdf', '.doc', '.docx', '.txt', '.rtf']), 'Resume must be .pdf, .doc, .docx, .txt, or .rtf.');

    let completedIds = [];
    let interactions = [];
    try {
      completedIds = JSON.parse(fields.completedIds || '[]');
      interactions = JSON.parse(fields.interactions || '[]');
    } catch {
      return sendJson(res, 400, { error: 'Invalid submission metadata.' });
    }

    const resumeProfile = buildResumeProfile(resumeFile, fields);
    const savedCase = await saveUploadedFile(submissionFile, 'submission');
    const savedResume = await saveUploadedFile(resumeFile, 'resume');
    const report = generateSubmissionReport({
      studentName,
      checklist: db.caseStudy.checklist || [],
      completedIds,
      interactions
    });

    const submission = {
      id: crypto.randomUUID(),
      studentName,
      studentEmail,
      college,
      expectedGraduationDate,
      major,
      submittedAt: new Date().toISOString(),
      fileName: savedCase.fileName,
      storedName: savedCase.storedName,
      mimeType: savedCase.mimeType,
      fileSize: savedCase.fileSize,
      resumeFileName: savedResume.fileName,
      resumeStoredName: savedResume.storedName,
      resumeMimeType: savedResume.mimeType,
      resumeFileSize: savedResume.fileSize,
      resumeProfile,
      completedIds,
      interactions,
      report
    };

    db.submissions.unshift(submission);
    await writeDb(db);

    return sendJson(res, 200, {
      ok: true,
      submission: {
        id: submission.id,
        studentName: submission.studentName,
        submittedAt: submission.submittedAt,
        fileName: submission.fileName,
        resumeFileName: submission.resumeFileName
      }
    });
  }

  if (req.method === 'GET' && pathname === '/api/host/submissions') {
    if (!isHostRequest(req, searchParams)) return sendJson(res, 401, { error: 'Host password required.' });
    const db = await readDb();
    const submissions = db.submissions.map(publicSubmissionSummary);
    return sendJson(res, 200, { submissions });
  }

  if (req.method === 'GET' && pathname === '/api/host/export.csv') {
    if (!isHostRequest(req, searchParams)) return sendText(res, 401, 'Host password required.');
    const db = await readDb();
    const csv = submissionsToCsv(db.submissions);
    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': 'attachment; filename="turner-finance-futures-submissions.csv"',
      'Cache-Control': 'no-store'
    });
    return res.end(csv);
  }

  if (req.method === 'GET' && pathname.startsWith('/api/submission-file/')) {
    if (!isHostRequest(req, searchParams)) return sendText(res, 401, 'Host password required.');
    const db = await readDb();
    const submission = findSubmissionById(db, pathname);
    if (!submission) return sendText(res, 404, 'Submission not found.');
    return streamStoredFile(res, submission.storedName, submission.fileName, submission.mimeType);
  }

  if (req.method === 'GET' && pathname.startsWith('/api/resume-file/')) {
    if (!isHostRequest(req, searchParams)) return sendText(res, 401, 'Host password required.');
    const db = await readDb();
    const submission = findSubmissionById(db, pathname);
    if (!submission) return sendText(res, 404, 'Submission not found.');
    if (!submission.resumeStoredName) return sendText(res, 404, 'Resume not found for this submission.');
    return streamStoredFile(res, submission.resumeStoredName, submission.resumeFileName, submission.resumeMimeType);
  }

  if (req.method === 'POST' && pathname === '/api/host/reset') {
    if (!isHostRequest(req, searchParams)) return sendJson(res, 401, { error: 'Host password required.' });
    await fs.rm(UPLOAD_DIR, { recursive: true, force: true });
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    await writeDb({ ...DEFAULT_DB, submissions: [], helpQuestions: [] });
    return sendJson(res, 200, { ok: true });
  }

  return sendJson(res, 404, { error: 'API route not found.' });
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const pathname = url.pathname;

    if (pathname.startsWith('/api/')) {
      return await handleApi(req, res, pathname, url.searchParams);
    }

    return await serveStatic(req, res, pathname);
  } catch (error) {
    const statusCode = error.statusCode || 500;
    const message = statusCode >= 500 ? 'Server error.' : error.message;
    if (statusCode >= 500) console.error(error);
    return sendJson(res, statusCode, { error: message });
  }
}

await ensureStorage();
const server = http.createServer(requestHandler);
server.listen(PORT, () => {
  console.log(`Turner Finance Futures Program running at http://localhost:${PORT}`);
});
