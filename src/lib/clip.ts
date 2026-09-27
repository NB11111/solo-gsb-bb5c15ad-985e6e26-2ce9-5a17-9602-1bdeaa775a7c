/**
 * 剪辑版字幕：读取最终合并结果（只读，不改原合并结果），按用户逐行给出的
 * 源片段（起点/终点毫秒，非负整数且起点小于终点）重新拼接成一条新的成片
 * 时间轴。行序即成片顺序，允许重复、重叠与倒序片段；片段按原时长首尾拼接，
 * 对每条字幕与每个片段的半开区间 [start, end) 求交，仅保留正时长交集，
 * 裁切后减去片段起点、加上此前片段总时长，文本原样复制。跨片段字幕分别
 * 输出，重复片段重复输出，空白片段仍占时长，不合并相邻同文字幕。
 *
 * 模块为纯函数：输入（片段文本或上游最终结果）变化时由调用方即时重算。
 */

export interface ClipSegment {
  /** 源片段起点（毫秒，非负整数） */
  start: number;
  /** 源片段终点（毫秒，非负整数，严格大于 start） */
  end: number;
  /** 输入行号（从 1 起，空行也计入行号） */
  line: number;
}

export interface BadClipLine {
  /** 行号（从 1 起，空行也计入行号） */
  line: number;
  raw: string;
  reason: string;
}

export interface ClipParseResult {
  /** 解析成功的片段，按行序（即成片顺序） */
  segments: ClipSegment[];
  /** 无法解析或起点不小于终点的行 */
  invalid: BadClipLine[];
  /** 非空行总数（含非法行） */
  totalLines: number;
}

/** 一行的合法形态：两个非负整数，之间为空白/逗号/箭头类分隔符。 */
const CLIP_LINE = /^(\d+)[\s,;:|/~>\-]+(\d+)$/;

/**
 * 解析片段列表：每行 “起点毫秒 终点毫秒”（也兼容逗号、`-->` 等分隔）。
 * 忽略 BOM 与空行；格式错误、非整数、负数、起点不小于终点的行记入
 * invalid 并标出行号，不影响其余行参与计算。
 */
export function parseClipList(text: string): ClipParseResult {
  const normalized = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const segments: ClipSegment[] = [];
  const invalid: BadClipLine[] = [];
  let totalLines = 0;
  normalized.split('\n').forEach((raw, idx) => {
    const line = raw.trim();
    if (!line) return;
    totalLines++;
    const lineNo = idx + 1;
    const m = line.match(CLIP_LINE);
    if (!m) {
      invalid.push({ line: lineNo, raw: line, reason: '应为两个非负整数毫秒：起点 终点' });
      return;
    }
    const start = Number(m[1]);
    const end = Number(m[2]);
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end)) {
      invalid.push({ line: lineNo, raw: line, reason: '数值超出安全整数范围' });
      return;
    }
    if (start >= end) {
      invalid.push({ line: lineNo, raw: line, reason: '起点必须小于终点' });
      return;
    }
    segments.push({ start, end, line: lineNo });
  });
  return { segments, invalid, totalLines };
}

export interface ClipCue {
  /** 新（成片）时间轴上的开始（毫秒） */
  start: number;
  /** 新（成片）时间轴上的结束（毫秒） */
  end: number;
  /** 文本（原样复制） */
  text: string;
  /** 来源片段下标（0 基，按行序） */
  segment: number;
  /** 来源字幕在上游最终结果中的下标（0 基） */
  source: number;
}

export interface ClipSegmentInfo {
  /** 输入行号（从 1 起） */
  line: number;
  /** 源片段起点（毫秒） */
  start: number;
  /** 源片段终点（毫秒） */
  end: number;
  /** 片段原时长（毫秒） */
  duration: number;
  /** 该片段在新时间轴上的起点（此前片段总时长） */
  offset: number;
  /** 该片段裁出的字幕条数（0 即空白片段，仍占时长） */
  count: number;
}

export interface ClipResult {
  /** 成片时间轴上的字幕，按输出顺序（时间单调） */
  cues: ClipCue[];
  /** 与输入片段一一对应的统计（含空白片段） */
  segments: ClipSegmentInfo[];
  /** 成片总时长（全部片段原时长之和，毫秒） */
  totalMs: number;
}

/**
 * 按片段列表把上游最终字幕重排到成片时间轴：片段按行序以原时长首尾拼接；
 * 每条字幕与每个片段的半开区间求交，仅保留正时长交集，平移后输出。
 * 输入 cues 不被修改；segments 通常来自 parseClipList（已保证起点小于终点）。
 */
export function buildClipCues(
  cues: ReadonlyArray<{ start: number; end: number; text: string }>,
  segments: ReadonlyArray<{ start: number; end: number; line?: number }>,
): ClipResult {
  const out: ClipCue[] = [];
  const infos: ClipSegmentInfo[] = [];
  let offset = 0;
  segments.forEach((seg, si) => {
    const duration = seg.end - seg.start;
    let count = 0;
    cues.forEach((c, ci) => {
      const s = Math.max(c.start, seg.start);
      const e = Math.min(c.end, seg.end);
      if (e - s <= 0) return; // 半开区间交集：仅保留正时长
      out.push({
        start: s - seg.start + offset,
        end: e - seg.start + offset,
        text: c.text,
        segment: si,
        source: ci,
      });
      count++;
    });
    infos.push({
      line: seg.line ?? si + 1,
      start: seg.start,
      end: seg.end,
      duration,
      offset,
      count,
    });
    offset += duration; // 空白片段仍占时长
  });
  return { cues: out, segments: infos, totalMs: offset };
}
