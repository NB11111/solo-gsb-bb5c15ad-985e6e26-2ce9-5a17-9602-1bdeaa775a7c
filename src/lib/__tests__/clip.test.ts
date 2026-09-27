import { describe, expect, it } from 'vitest';
import { buildClipCues, parseClipList } from '../clip';

function cue(start: number, end: number, text = '字幕文本') {
  return { start, end, text };
}

describe('parseClipList 片段列表解析', () => {
  it('每行 “起点 终点” 毫秒，按行序返回', () => {
    const r = parseClipList('0 5200\n13000 21400\n');
    expect(r.invalid).toEqual([]);
    expect(r.segments).toEqual([
      { start: 0, end: 5200, line: 1 },
      { start: 13000, end: 21400, line: 2 },
    ]);
    expect(r.totalLines).toBe(2);
  });

  it('兼容逗号、箭头、波浪线等分隔与多余空白，忽略空行与 BOM', () => {
    const r = parseClipList('﻿ 100,200 \n\n300 --> 400\n500~600\n700\t800\n');
    expect(r.invalid).toEqual([]);
    expect(r.segments.map((s) => [s.start, s.end])).toEqual([
      [100, 200],
      [300, 400],
      [500, 600],
      [700, 800],
    ]);
    expect(r.totalLines).toBe(4);
  });

  it('行号按原文行计（空行也占行号）', () => {
    const r = parseClipList('0 100\n\n坏行\n200 300\n');
    expect(r.invalid.map((b) => b.line)).toEqual([3]);
    expect(r.segments.map((s) => s.line)).toEqual([1, 4]);
  });

  it('格式错误标出行号与原因：非数字、缺项、负数、小数、多余数字', () => {
    const r = parseClipList('abc\n100\n-5 10\n1.5 3\n100 200 300\n');
    expect(r.segments).toEqual([]);
    expect(r.invalid.map((b) => b.line)).toEqual([1, 2, 3, 4, 5]);
    expect(r.invalid.every((b) => b.reason.includes('两个非负整数'))).toBe(true);
    expect(r.totalLines).toBe(5);
  });

  it('起点必须小于终点：相等或倒序均报错', () => {
    const r = parseClipList('100 100\n500 200\n0 1\n');
    expect(r.invalid.map((b) => b.line)).toEqual([1, 2]);
    expect(r.invalid[0].reason).toContain('起点必须小于终点');
    expect(r.segments).toEqual([{ start: 0, end: 1, line: 3 }]);
  });

  it('超出安全整数范围的数值报错', () => {
    const r = parseClipList('0 99999999999999999999');
    expect(r.segments).toEqual([]);
    expect(r.invalid[0].reason).toContain('安全整数');
  });

  it('空文本', () => {
    const r = parseClipList('');
    expect(r.segments).toEqual([]);
    expect(r.invalid).toEqual([]);
    expect(r.totalLines).toBe(0);
  });
});

describe('buildClipCues 基本拼接', () => {
  it('单个片段：裁切后减去片段起点', () => {
    const r = buildClipCues([cue(1000, 3000, '甲')], [{ start: 500, end: 4000 }]);
    expect(r.cues).toEqual([{ start: 500, end: 2500, text: '甲', segment: 0, source: 0 }]);
    expect(r.totalMs).toBe(3500);
    expect(r.segments[0]).toMatchObject({ offset: 0, duration: 3500, count: 1 });
  });

  it('多个片段按原时长首尾拼接：后续片段偏移为此前总时长', () => {
    const r = buildClipCues(
      [cue(0, 2000, '甲'), cue(10000, 12000, '乙')],
      [
        { start: 0, end: 3000 }, // 时长 3000
        { start: 9000, end: 13000 }, // 时长 4000，偏移 3000
      ],
    );
    expect(r.cues).toEqual([
      { start: 0, end: 2000, text: '甲', segment: 0, source: 0 },
      { start: 4000, end: 6000, text: '乙', segment: 1, source: 1 },
    ]);
    expect(r.totalMs).toBe(7000);
    expect(r.segments[1].offset).toBe(3000);
  });

  it('片段两端裁切字幕：交集平移到片段内时间', () => {
    const r = buildClipCues([cue(1000, 5000, '甲')], [{ start: 2000, end: 4000 }]);
    expect(r.cues).toEqual([{ start: 0, end: 2000, text: '甲', segment: 0, source: 0 }]);
  });

  it('不修改输入字幕数组', () => {
    const cues = [cue(1000, 3000, '甲')];
    buildClipCues(cues, [{ start: 0, end: 2000 }]);
    expect(cues[0]).toEqual({ start: 1000, end: 3000, text: '甲' });
  });
});

describe('buildClipCues 半开区间求交', () => {
  it('仅保留正时长交集：端点相接（零时长）不输出', () => {
    const cues = [cue(0, 1000, '甲'), cue(1000, 2000, '乙'), cue(2000, 3000, '丙')];
    const r = buildClipCues(cues, [{ start: 1000, end: 2000 }]);
    expect(r.cues).toEqual([{ start: 0, end: 1000, text: '乙', segment: 0, source: 1 }]);
  });

  it('字幕恰在片段之外（两侧）不输出', () => {
    const cues = [cue(0, 500, '前'), cue(3000, 3500, '后')];
    const r = buildClipCues(cues, [{ start: 1000, end: 2000 }]);
    expect(r.cues).toEqual([]);
    expect(r.segments[0].count).toBe(0);
  });

  it('1 毫秒的正交集也保留', () => {
    const r = buildClipCues([cue(0, 1001, '甲')], [{ start: 1000, end: 2000 }]);
    expect(r.cues).toEqual([{ start: 0, end: 1, text: '甲', segment: 0, source: 0 }]);
  });
});

describe('buildClipCues 跨片段 / 重复 / 重叠 / 倒序', () => {
  it('跨片段字幕分别输出：同一字幕在两个片段各占一段', () => {
    const cues = [cue(0, 10000, '长字幕')];
    const r = buildClipCues(cues, [
      { start: 1000, end: 3000 }, // 时长 2000
      { start: 6000, end: 9000 }, // 时长 3000，偏移 2000
    ]);
    expect(r.cues).toEqual([
      { start: 0, end: 2000, text: '长字幕', segment: 0, source: 0 },
      { start: 2000, end: 5000, text: '长字幕', segment: 1, source: 0 },
    ]);
  });

  it('重复片段重复输出同一批字幕', () => {
    const cues = [cue(100, 900, '重播')];
    const r = buildClipCues(cues, [
      { start: 0, end: 1000 },
      { start: 0, end: 1000 },
    ]);
    expect(r.cues).toEqual([
      { start: 100, end: 900, text: '重播', segment: 0, source: 0 },
      { start: 1100, end: 1900, text: '重播', segment: 1, source: 0 },
    ]);
    expect(r.totalMs).toBe(2000);
  });

  it('重叠片段各自独立求交，互不影响', () => {
    const cues = [cue(1000, 4000, '甲')];
    const r = buildClipCues(cues, [
      { start: 0, end: 3000 }, // 交集 [1000,3000)
      { start: 2000, end: 5000 }, // 交集 [2000,4000)，偏移 3000
    ]);
    expect(r.cues).toEqual([
      { start: 1000, end: 3000, text: '甲', segment: 0, source: 0 },
      { start: 3000, end: 5000, text: '甲', segment: 1, source: 0 },
    ]);
  });

  it('倒序片段：行序即成片顺序，源时间可倒退', () => {
    const cues = [cue(0, 1000, '前段'), cue(9000, 10000, '后段')];
    const r = buildClipCues(cues, [
      { start: 9000, end: 10000 }, // 源靠后的片段先播
      { start: 0, end: 1000 },
    ]);
    expect(r.cues).toEqual([
      { start: 0, end: 1000, text: '后段', segment: 0, source: 1 },
      { start: 1000, end: 2000, text: '前段', segment: 1, source: 0 },
    ]);
    // 输出时间轴整体单调
    for (let i = 1; i < r.cues.length; i++) {
      expect(r.cues[i].start).toBeGreaterThanOrEqual(r.cues[i - 1].end);
    }
  });
});

describe('buildClipCues 空白片段与同文字幕', () => {
  it('空白片段仍占时长：后续片段偏移包含其时长', () => {
    const cues = [cue(10000, 11000, '甲')];
    const r = buildClipCues(cues, [
      { start: 0, end: 5000 }, // 空白（无字幕落入）
      { start: 10000, end: 12000 }, // 偏移 5000
    ]);
    expect(r.segments[0]).toMatchObject({ count: 0, duration: 5000, offset: 0 });
    expect(r.segments[1]).toMatchObject({ count: 1, offset: 5000 });
    expect(r.cues).toEqual([{ start: 5000, end: 6000, text: '甲', segment: 1, source: 0 }]);
    expect(r.totalMs).toBe(7000);
  });

  it('不合并相邻同文字幕：逐条原样输出', () => {
    const cues = [cue(0, 1000, '同上'), cue(1000, 2000, '同上')];
    const r = buildClipCues(cues, [{ start: 0, end: 2000 }]);
    expect(r.cues).toHaveLength(2);
    expect(r.cues[0].text).toBe('同上');
    expect(r.cues[1].text).toBe('同上');
  });

  it('文本原样复制（含换行与标签）', () => {
    const text = '第一行\n<i>第二行</i>';
    const r = buildClipCues([cue(500, 1500, text)], [{ start: 0, end: 2000 }]);
    expect(r.cues[0].text).toBe(text);
  });
});

describe('buildClipCues 边界输入', () => {
  it('无片段：结果为空、总时长为 0', () => {
    const r = buildClipCues([cue(0, 1000)], []);
    expect(r.cues).toEqual([]);
    expect(r.segments).toEqual([]);
    expect(r.totalMs).toBe(0);
  });

  it('无字幕：片段信息保留、结果为空', () => {
    const r = buildClipCues([], [{ start: 0, end: 1000, line: 3 }]);
    expect(r.cues).toEqual([]);
    expect(r.segments).toEqual([
      { line: 3, start: 0, end: 1000, duration: 1000, offset: 0, count: 0 },
    ]);
    expect(r.totalMs).toBe(1000);
  });

  it('输出顺序按片段行序、片段内按原字幕顺序', () => {
    const cues = [cue(0, 1000, '一'), cue(2000, 3000, '二')];
    const r = buildClipCues(cues, [
      { start: 0, end: 4000 },
      { start: 0, end: 4000 },
    ]);
    expect(r.cues.map((c) => c.text)).toEqual(['一', '二', '一', '二']);
    expect(r.cues.map((c) => c.segment)).toEqual([0, 0, 1, 1]);
  });
});
