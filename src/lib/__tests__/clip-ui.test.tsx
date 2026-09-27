import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { ClipPanel } from '../../components/ClipPanel';
import { buildClipCues, parseClipList } from '../clip';
import { serializeSrt } from '../srt';

const noop = () => {};

const CUES = [
  { start: 1000, end: 3000, text: '第一条字幕' },
  { start: 10000, end: 12000, text: '第二条字幕' },
];

function renderPanel(
  clipText: string,
  opts: { upstreamReady?: boolean; cues?: { start: number; end: number; text: string }[] } = {},
) {
  const cues = opts.cues ?? CUES;
  const parsed = parseClipList(clipText);
  const result = buildClipCues(cues, parsed.segments);
  return renderToString(
    <ClipPanel
      upstreamCount={cues.length}
      upstreamReady={opts.upstreamReady ?? true}
      clipText={clipText}
      onClipText={noop}
      parsed={parsed}
      result={result}
      preview={serializeSrt(result.cues)}
      onExport={noop}
    />,
  );
}

describe('ClipPanel 渲染冒烟', () => {
  it('展示片段输入、统计、片段表与新时间轴预览', () => {
    const html = renderPanel('0 4000\n9000 13000\n');
    expect(html).toContain('源片段列表');
    expect(html).toContain('每行：起点毫秒 终点毫秒');
    expect(html).toContain('已解析');
    expect(html).toContain('个片段');
    expect(html).toContain('成片总时长');
    expect(html).toContain('新时间轴区间');
    expect(html).toContain('新时间轴预览');
    expect(html).toContain('第一条字幕');
    expect(html).toContain('下载剪辑版 SRT');
  });

  it('片段表展示行号、源区间与新时间轴区间，空白片段标注', () => {
    // 片段 2 [4000,9000) 内没有字幕 → 空白片段
    const html = renderPanel('0 4000\n4000 9000\n9000 13000\n');
    expect(html).toContain('空白片段');
    expect(html).toContain('仍占时长');
  });

  it('格式错误标出行号并禁止下载', () => {
    const html = renderPanel('0 4000\n坏行\n');
    expect(html).toContain('行格式错误');
    expect(html).toContain('坏行');
    expect(html).toContain('两个非负整数');
    expect(html).toContain('disabled');
    expect(html).toContain('片段列表存在 1 行错误');
  });

  it('起点不小于终点标为错误', () => {
    const html = renderPanel('500 200\n');
    expect(html).toContain('起点必须小于终点');
    expect(html).toContain('disabled');
  });

  it('上游不可导出时禁止下载', () => {
    const html = renderPanel('0 4000\n', { upstreamReady: false });
    expect(html).toContain('上游结果存在未解决冲突或校验错误');
    expect(html).toContain('disabled');
  });

  it('结果为空时禁止下载', () => {
    const html = renderPanel('50000 60000\n');
    expect(html).toContain('剪辑结果为空');
    expect(html).toContain('disabled');
  });

  it('未填写片段时提示输入', () => {
    const html = renderPanel('');
    expect(html).toContain('请先逐行填写源片段');
    expect(html).toContain('行序即成片顺序');
  });

  it('重复片段在预览中重复输出且重新编号', () => {
    const html = renderPanel('0 4000\n0 4000\n');
    // 同一条字幕出现两次，且第二条编号为 2、时间平移一个片段时长
    expect(html).toContain('00:00:01,000 --&gt; 00:00:03,000');
    expect(html).toContain('00:00:05,000 --&gt; 00:00:07,000');
  });
});
