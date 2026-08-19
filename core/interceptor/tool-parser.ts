import type { ToolCall, ToolError } from '../types';
import {
  createToolCallFromInvocation,
  createToolInvocationCatalog,
  getToolInvocationLabel,
  type ToolInvocationCatalog,
  type ToolParsingInput,
} from '../tool';
import { findFirstXmlToolTag } from '../tool/xml-tags';

export const LEGACY_TOOL_CALLS_OPEN_TAG = '<｜DSML｜tool_calls>';
export const LEGACY_TOOL_CALLS_CLOSE_TAG = '</｜DSML｜tool_calls>';

const LEGACY_INVOKE_OPEN_PREFIX = '<｜DSML｜invoke name="';
const LEGACY_INVOKE_CLOSE_TAG = '</｜DSML｜invoke>';
const LEGACY_PARAMETER_OPEN_PREFIX = '<｜DSML｜parameter name="';
const LEGACY_PARAMETER_TYPE_PREFIX = '" string="';
const LEGACY_PARAMETER_CLOSE_TAG = '</｜DSML｜parameter>';



export function extractToolCalls(text: string, input?: ToolParsingInput): ToolCall[] {
  let normalizedText = text;
  const catalog = createToolInvocationCatalog(input?.descriptors);
  for (const wrapper of ['tool_calls', 'tool_call', 'invoke']) {
    const closeWrapper = `</${wrapper}>`;
    if (normalizedText.includes(closeWrapper)) {
      for (const name of catalog.invocationNames) {
        const openTag = `<${name}>`;
        if (normalizedText.includes(openTag) && !normalizedText.includes(`</${name}>`)) {
          normalizedText = normalizedText.replace(closeWrapper, `</${name}>${closeWrapper}`);
        }
      }
      normalizedText = normalizedText.replace(new RegExp(`<\\/?${wrapper}[^>]*>`, 'g'), '');
    }
  }

  return [
    ...extractXmlToolCalls(normalizedText, catalog),
    ...extractLegacyToolCalls(normalizedText, catalog),
  ];
}

/**
 * Linear-time XML tool-call extraction. The previous `[\s\S]*?` regex family
 * exhibited catastrophic backtracking on long whitespace runs without a
 * matching closing tag (ReDoS, H1); the scanner below is strictly linear and
 * preserves the regex semantics: the first complete `<name>…</name>` block
 * with a matching name, scanning forward for the first closing tag of the
 * same name.
 */
function extractXmlToolCalls(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  const names = catalog.invocationNames;
  if (names.length === 0 || !text) return calls;
  const nameSet = new Set(names);
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const open = findFirstXmlToolTag(text, nameSet, { closing: false, fromIndex });
    if (!open) break;
    const close = findFirstXmlToolTag(
      text,
      new Set([open.name]),
      { closing: true, fromIndex: open.endIndex },
    );
    if (!close) {
      fromIndex = open.endIndex;
      continue;
    }

    const raw = text.slice(open.index, close.endIndex);
    const body = text.slice(open.endIndex, close.index).trim();
    const invocationName = open.name;
    let payload: Record<string, unknown>;
    try {
      const parsed = body.length === 0 ? {} : JSON.parse(body);
      if (!isToolPayload(parsed)) {
        calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
          parseError: createToolParseError(
            'tool_call_payload_invalid',
            invocationName,
            'Tool call body must be a JSON object.',
          ),
        }));
        fromIndex = close.endIndex;
        continue;
      }
      payload = parsed;
    } catch (err) {
      calls.push(createToolCallFromInvocation(invocationName, {}, raw, catalog, {
        parseError: createToolParseError(
          'tool_call_json_invalid',
          invocationName,
          [
            'Tool call body is not valid JSON.',
            'Use double quotes for strings and escape backslashes in local file paths, for example "D:\\\\project\\\\file.txt" or "D:/project/file.txt".',
            err instanceof Error ? err.message : String(err),
          ].join(' '),
        ),
      }));
      fromIndex = close.endIndex;
      continue;
    }
    calls.push(createToolCallFromInvocation(invocationName, payload, raw, catalog));
    fromIndex = close.endIndex;
  }

  return calls;
}

/**
 * Linear-time legacy `｜DSML｜tool_calls` extraction. Replaces the
 * `[\s\S]*?`-based legacy regexes (same ReDoS class as the XML parser).
 */
function extractLegacyToolCalls(text: string, catalog: ToolInvocationCatalog): ToolCall[] {
  const calls: ToolCall[] = [];
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const openIdx = text.indexOf(LEGACY_TOOL_CALLS_OPEN_TAG, fromIndex);
    if (openIdx === -1) break;
    const closeIdx = text.indexOf(
      LEGACY_TOOL_CALLS_CLOSE_TAG,
      openIdx + LEGACY_TOOL_CALLS_OPEN_TAG.length,
    );
    if (closeIdx === -1) break;
    const blockEnd = closeIdx + LEGACY_TOOL_CALLS_CLOSE_TAG.length;
    const blockContent = text.slice(openIdx, blockEnd);
    extractLegacyInvokes(blockContent, catalog, calls);
    fromIndex = blockEnd;
  }

  return calls;
}

function extractLegacyInvokes(
  blockContent: string,
  catalog: ToolInvocationCatalog,
  calls: ToolCall[],
): void {
  let idx = 0;

  while (idx < blockContent.length) {
    const invokeOpenStart = blockContent.indexOf(LEGACY_INVOKE_OPEN_PREFIX, idx);
    if (invokeOpenStart === -1) break;
    const nameStart = invokeOpenStart + LEGACY_INVOKE_OPEN_PREFIX.length;
    // The released regex name class was [^"]+ terminated by `">`: the first
    // quote after the name must be followed immediately by `>`, otherwise the
    // whole tag is malformed and the engine skipped it while continuing the
    // scan. Mirror that instead of accepting quotes inside the name.
    const quoteIdx = blockContent.indexOf('"', nameStart);
    if (quoteIdx === -1 || blockContent[quoteIdx + 1] !== '>') {
      idx = invokeOpenStart + LEGACY_INVOKE_OPEN_PREFIX.length;
      continue;
    }
    const nameEnd = quoteIdx;
    // The released regex required a non-empty name ([^"]+); skip empty ones.
    if (nameEnd === nameStart) {
      idx = nameStart + 1;
      continue;
    }
    const invocationName = blockContent.slice(nameStart, nameEnd);
    const invokeCloseIdx = blockContent.indexOf(LEGACY_INVOKE_CLOSE_TAG, nameEnd + 2);
    if (invokeCloseIdx === -1) {
      // Unterminated invoke: the released regex matched nothing here and kept
      // scanning for the next well-formed invoke; continue instead of
      // abandoning the rest of the block.
      idx = nameEnd + 2;
      continue;
    }
    const invokeContent = blockContent.slice(nameEnd + 2, invokeCloseIdx);
    const invokeEnd = invokeCloseIdx + LEGACY_INVOKE_CLOSE_TAG.length;
    const raw = blockContent.slice(invokeOpenStart, invokeEnd);
    calls.push(createToolCallFromInvocation(
      invocationName,
      extractLegacyParameters(invokeContent),
      raw,
      catalog,
    ));
    idx = invokeEnd;
  }
}

function extractLegacyParameters(invokeContent: string): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  let idx = 0;

  while (idx < invokeContent.length) {
    const openStart = invokeContent.indexOf(LEGACY_PARAMETER_OPEN_PREFIX, idx);
    if (openStart === -1) break;
    const nameStart = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
    // The released regex required `name="([^"]+)" string="(true|false)"`: the
    // first quote after the name must be followed exactly by ` string="`,
    // otherwise the parameter is malformed and the regex skipped it while
    // continuing the scan.
    const quoteIdx = invokeContent.indexOf('"', nameStart);
    if (
      quoteIdx === -1
      || !invokeContent.startsWith(LEGACY_PARAMETER_TYPE_PREFIX, quoteIdx)
    ) {
      idx = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
      continue;
    }
    const nameEnd = quoteIdx;
    // The released regex required a non-empty name ([^"]+); skip empty ones.
    if (nameEnd === nameStart) {
      idx = nameStart + 1;
      continue;
    }
    const paramName = invokeContent.slice(nameStart, nameEnd);
    const typeStart = nameEnd + LEGACY_PARAMETER_TYPE_PREFIX.length;
    // The released regex required `string="(true|false)">` with no intervening
    // characters. Match the exact token instead of searching for a distant
    // `">` (which could swallow a later well-formed parameter).
    const isString = invokeContent.startsWith('true">', typeStart);
    if (!isString && !invokeContent.startsWith('false">', typeStart)) {
      idx = openStart + LEGACY_PARAMETER_OPEN_PREFIX.length;
      continue;
    }
    // The value starts right after the '>': 'true">' is 6 chars, 'false">' 7.
    const valueStart = typeStart + (isString ? 6 : 7);
    const valueEnd = invokeContent.indexOf(LEGACY_PARAMETER_CLOSE_TAG, valueStart);
    if (valueEnd === -1) {
      // Unterminated parameter value: the released regex matched nothing here
      // and kept scanning; continue instead of dropping later parameters.
      idx = valueStart;
      continue;
    }
    const value = invokeContent.slice(valueStart, valueEnd);
    if (isString) {
      payload[paramName] = value;
    } else {
      try {
        payload[paramName] = JSON.parse(value);
      } catch {
        payload[paramName] = value;
      }
    }
    idx = valueEnd + LEGACY_PARAMETER_CLOSE_TAG.length;
  }

  return payload;
}

interface ToolCallBlockRange {
  start: number;
  end: number;
}

/**
 * Collects every complete XML tool-call block in the text (linear scan).
 * A block is the first closing tag of the same name after an opening tag.
 */
function collectXmlToolCallBlocks(text: string, catalog: ToolInvocationCatalog): ToolCallBlockRange[] {
  const blocks: ToolCallBlockRange[] = [];
  const names = catalog.invocationNames;
  if (names.length === 0 || !text) return blocks;
  const nameSet = new Set(names);
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const open = findFirstXmlToolTag(text, nameSet, { closing: false, fromIndex });
    if (!open) break;
    const close = findFirstXmlToolTag(
      text,
      new Set([open.name]),
      { closing: true, fromIndex: open.endIndex },
    );
    if (!close) {
      fromIndex = open.endIndex;
      continue;
    }
    blocks.push({ start: open.index, end: close.endIndex });
    fromIndex = close.endIndex;
  }

  return blocks;
}

/** Collects every legacy `｜DSML｜tool_calls` block (linear scan). */
function collectLegacyToolCallBlocks(text: string): ToolCallBlockRange[] {
  const blocks: ToolCallBlockRange[] = [];
  let fromIndex = 0;

  while (fromIndex < text.length) {
    const openIdx = text.indexOf(LEGACY_TOOL_CALLS_OPEN_TAG, fromIndex);
    if (openIdx === -1) break;
    const closeIdx = text.indexOf(
      LEGACY_TOOL_CALLS_CLOSE_TAG,
      openIdx + LEGACY_TOOL_CALLS_OPEN_TAG.length,
    );
    if (closeIdx === -1) break;
    blocks.push({ start: openIdx, end: closeIdx + LEGACY_TOOL_CALLS_CLOSE_TAG.length });
    fromIndex = blocks[blocks.length - 1].end;
  }

  return blocks;
}

function replaceBlocksWithSummaries(
  text: string,
  blocks: readonly ToolCallBlockRange[],
  catalog: ToolInvocationCatalog,
): string {
  if (blocks.length === 0) return text;
  let output = '';
  let cursor = 0;
  for (const block of blocks) {
    output += text.slice(cursor, block.start);
    output += replaceMatchWithSummary(text.slice(block.start, block.end), catalog);
    cursor = block.end;
  }
  return output + text.slice(cursor);
}

function removeBlocks(text: string, blocks: readonly ToolCallBlockRange[]): string {
  if (blocks.length === 0) return text;
  let output = '';
  let cursor = 0;
  for (const block of blocks) {
    output += text.slice(cursor, block.start);
    cursor = block.end;
  }
  return output + text.slice(cursor);
}

export function stripToolCalls(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const withoutXml = removeBlocks(text, collectXmlToolCallBlocks(text, catalog));
  return removeBlocks(withoutXml, collectLegacyToolCallBlocks(withoutXml)).trim();
}

export function replaceToolCallsWithSummary(text: string, input?: ToolParsingInput): string {
  const catalog = createToolInvocationCatalog(input?.descriptors);
  const withXmlSummary = replaceBlocksWithSummaries(
    text,
    collectXmlToolCallBlocks(text, catalog),
    catalog,
  );
  return replaceBlocksWithSummaries(
    withXmlSummary,
    collectLegacyToolCallBlocks(withXmlSummary),
    catalog,
  );
}

function replaceMatchWithSummary(match: string, catalog: ToolInvocationCatalog): string {
  const calls = extractToolCalls(match, { descriptors: catalog.descriptors });
  if (calls.length === 0) return '';
  const lines = calls.map(call => {
    const name = call.name;
    if (call.parseError) return `• ${getToolInvocationLabel(name, catalog)}：格式错误`;
    const detail = (call.payload as any).name || (call.payload as any).content || (call.payload as any).id || '';
    return `• ${getToolInvocationLabel(name, catalog)}${detail ? '：' + detail : ''}`;
  });
  const executedCount = calls.filter(call => !call.parseError).length;
  const header = executedCount === calls.length
    ? `🔧 已调用工具（${calls.length}次）`
    : `🔧 已调用工具（${executedCount}次，${calls.length - executedCount}次格式错误）`;
  return '\n\n---\n' + header + '\n' + lines.join('\n') + '\n---';
}

function isToolPayload(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function createToolParseError(code: string, invocationName: string, message: string): ToolError {
  return {
    code,
    message,
    retryable: false,
    details: { invocationName },
  };
}
