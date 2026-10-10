"use client";
import { memo, type ReactNode } from "react";
import { useEditor } from "../../lib/editor/store.ts";
import { formatTime } from "../../lib/editor/time.ts";
import { Icon } from "./icons.tsx";

/** The playhead's time, kept in its own component so the canvas and panels do not re-render on every frame of playback. */
function Clock() {
  const t = useEditor((s) => s.t);
  const fps = useEditor((s) => s.fps);
  const duration = useEditor((s) => s.duration);
  return (
    <>
      <span className="ed-tp-time" aria-label={`Current time ${formatTime(t, fps)}`}>{formatTime(t, fps)}</span>
      <span className="ed-tp-end">/ {formatTime(duration, fps)} · frame {Math.round(t * fps)}</span>
    </>
  );
}

/** Go to start, previous frame, play / pause, next frame, and the time, under the canvas (after the design handoff). */
export const Transport = memo(function Transport({ trailing }: { trailing?: ReactNode }) {
  const playing = useEditor((s) => s.playing);
  const st = () => useEditor.getState();
  return (
    <div className="ed-transport" role="toolbar" aria-label="Transport">
      <button type="button" className="ed-tp-b" aria-label="Go to work area start" title="Go to start" onClick={() => st().setT(st().doc.workArea[0])}><Icon name="stepBack" size={13} /></button>
      <button type="button" className="ed-tp-b" aria-label="Previous frame" title="Previous frame (←)" onClick={() => st().setT(st().t - 1 / st().fps)}><Icon name="chevL" size={13} /></button>
      <button type="button" className="ed-tp-play" aria-pressed={playing} onClick={() => st().ui({ playing: !playing })}>
        <Icon name={playing ? "pause" : "play"} size={13} />{playing ? "Pause" : "Play"}<kbd>Space</kbd>
      </button>
      <button type="button" className="ed-tp-b" aria-label="Next frame" title="Next frame (→)" onClick={() => st().setT(st().t + 1 / st().fps)}><Icon name="chevR" size={13} /></button>
      <Clock />
      {trailing ? <div className="ed-tp-trail">{trailing}</div> : null}
    </div>
  );
});
