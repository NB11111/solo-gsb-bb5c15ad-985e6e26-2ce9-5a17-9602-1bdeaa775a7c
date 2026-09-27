import { useRef, useState } from 'react';
import type { ClipParseResult, ClipResult } from '../lib/clip';
import { formatTimecode } from '../lib/srt';

const PAGE = 100;

interface ClipPanelProps {
  /** 上游最终字幕条数（只读引用，不修改原合并结果） */
  upstreamCount: number;
  /** 上游是否已可导出（存在未解决冲突或校验错误时为 false） */
  upstreamReady: boolean;
  /** 片段列表文本（每行：起点毫秒 终点毫秒） */
  clipText: string;
  onClipText(text: string): void;
  /** 片段文本的解析结果（含非法行号） */
  parsed: ClipParseResult;
  /** 当前片段列表与上游结果算出的成片时间轴 */
  result: ClipResult;
  /** 重新编号后的完整 SRT 预览（可能已截断） */
  preview: string;
  onExport(): void;
}

const fmtSec = (ms: number) => `${(ms / 1000).toFixed(1)} 秒`;

export function ClipPanel(props: ClipPanelProps) {
  const { parsed, result, clipText, upstreamReady } = props;
  const [shown, setShown] = useState(PAGE);
  const fileRef = useRef<HTMLInputElement>(null);

  const hasErrors = parsed.invalid.length > 0;
  const canDownload = upstreamReady && !hasErrors && result.cues.length > 0;

  let disabledReason = '';
  if (!upstreamReady) disabledReason = '上游结果存在未解决冲突或校验错误，暂不可导出';
  else if (hasErrors) disabledReason = `片段列表存在 ${parsed.invalid.length} 行错误`;
  else if (parsed.totalLines === 0) disabledReason = '请先逐行填写源片段';
  else if (result.cues.length === 0) disabledReason = '剪辑结果为空（片段区间内没有字幕）';

  const readFile = (file: File) => {
    const reader = new FileReader();
    reader.onload = () => props.onClipText(String(reader.result ?? ''));
    reader.readAsText(file);
  };

  const emptySegments = result.segments.filter((s) => s.count === 0).length;

  return (
    <section className="wrap-panel clip-panel">
      <div className="snap-input">
        <div className="snap-input-head">
          <strong>源片段列表</strong>
          <span className="tag dim">每行：起点毫秒 终点毫秒（非负整数，起点 &lt; 终点）</span>
          <span className="spacer" />
          <button className="btn sm" onClick={() => fileRef.current?.click()}>
            上传片段文件
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".txt,.csv,text/plain"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) readFile(f);
              e.target.value = '';
            }}
          />
          {clipText.length > 0 && (
            <button className="btn sm" onClick={() => props.onClipText('')}>
              清空
            </button>
          )}
        </div>
        <textarea
          className="snap-paste"
          placeholder={'逐行填写源片段起止毫秒，行序即成片顺序，例如：\n0 5200\n13000 21400\n0 5200'}
          value={clipText}
          spellCheck={false}
          onChange={(e) => props.onClipText(e.target.value)}
        />
        {parsed.totalLines > 0 && (
          <div className="snap-parse">
            {hasErrors ? (
              <span className="tag warn">
                ⚠ {parsed.invalid.length} 行格式错误
                {parsed.segments.length > 0 && `，其余 ${parsed.segments.length} 个片段可用`}
              </span>
            ) : (
              <span className="tag ok">✓ 已解析 {parsed.segments.length} 个片段</span>
            )}
            {parsed.invalid.slice(0, 5).map((b) => (
              <span className="snap-badline" key={b.line} title={`${b.raw}（${b.reason}）`}>
                第 {b.line} 行：{b.raw}（{b.reason}）
              </span>
            ))}
            {parsed.invalid.length > 5 && (
              <span className="snap-badline">…等 {parsed.invalid.length} 行</span>
            )}
          </div>
        )}
      </div>

      <div className="wrap-summary">
        上游最终字幕 {props.upstreamCount} 条 · 片段 {result.segments.length} 个 · 成片总时长{' '}
        {fmtSec(result.totalMs)} · 输出 {result.cues.length} 条
        {emptySegments > 0 && <em> · {emptySegments} 个空白片段（仍占时长）</em>}
        {hasErrors && <em> · 存在错误行，修正前禁止下载</em>}
        {!upstreamReady && <em> · 上游不可导出，下载已禁用</em>}
        <span className="wrap-hint">
          片段按原时长首尾拼接；字幕与片段半开区间求交、仅保留正时长交集；跨片段字幕分别输出，
          重复片段重复输出，不合并相邻同文字幕
        </span>
      </div>

      {result.segments.length > 0 && (
        <div className="clip-table-wrap">
          <table className="clip-table">
            <thead>
              <tr>
                <th>#</th>
                <th>行号</th>
                <th>源区间（毫秒）</th>
                <th>时长</th>
                <th>新时间轴区间</th>
                <th>条数</th>
              </tr>
            </thead>
            <tbody>
              {result.segments.slice(0, shown).map((s, i) => (
                <tr key={i} className={s.count === 0 ? 'clip-empty' : ''}>
                  <td className="mono">{i + 1}</td>
                  <td className="mono">{s.line}</td>
                  <td className="mono">
                    {s.start} → {s.end}
                  </td>
                  <td className="mono">{fmtSec(s.duration)}</td>
                  <td className="mono">
                    {formatTimecode(s.offset)} → {formatTimecode(s.offset + s.duration)}
                  </td>
                  <td>
                    {s.count === 0 ? <span className="tag dim">空白片段</span> : s.count}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {result.segments.length > shown && (
            <button className="btn more" onClick={() => setShown((v) => v + PAGE)}>
              显示更多（剩余 {result.segments.length - shown} 个片段）
            </button>
          )}
        </div>
      )}

      {result.segments.length === 0 && parsed.totalLines === 0 && (
        <div className="empty">
          请逐行填写源片段的起止毫秒（行序即成片顺序，允许重复、重叠与倒序片段），
          系统将基于当前最终字幕结果生成新的成片时间轴。
        </div>
      )}
      {result.segments.length === 0 && parsed.totalLines > 0 && hasErrors && (
        <div className="empty">所有行均无法解析，请按 “起点毫秒 终点毫秒” 的格式修正。</div>
      )}

      <h3 className="panel-sub">新时间轴预览（导出时从 1 重新编号）</h3>
      <pre className="preview">{result.cues.length > 0 ? props.preview : '（暂无内容）'}</pre>

      <button
        className="btn primary lg block"
        disabled={!canDownload}
        title={canDownload ? '下载 clipped.srt' : disabledReason}
        onClick={props.onExport}
      >
        {canDownload ? '下载剪辑版 SRT' : disabledReason || '暂不可下载'}
      </button>
    </section>
  );
}
