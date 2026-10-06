import type { AudioResult, PlannerInfo, Scene } from "@videosaas/contracts";

type StoryboardProps = { scenes: Scene[]; activeScene: number; planner?: PlannerInfo; audio?: AudioResult };

function plannerLabel(planner?: PlannerInfo) {
  if (!planner) return "Example storyboard";
  return planner.provider === "anthropic" ? `Planned by Claude${planner.model ? ` · ${planner.model}` : ""}` : "Offline planner (no Claude)";
}

export function Storyboard({ scenes, activeScene, planner, audio }: StoryboardProps) {
  const totalSeconds = scenes.reduce((sum, scene) => sum + scene.duration, 0);
  return (
    <section className="panel storyboard" aria-labelledby="storyboard-title">
      <div className="panel-heading compact-heading">
        <div>
          <span className="eyebrow">03 · Storyboard</span>
          <h2 id="storyboard-title">Your video, mapped.</h2>
          <span className="scene-planner">{plannerLabel(planner)}</span>
        </div>
        <span className="scene-total">{scenes.length} scenes · {totalSeconds} sec</span>
      </div>
      <ol className="scene-list">
        {scenes.map((scene, index) => (
          <li className={`scene ${index === activeScene ? "active" : ""}`} key={scene.id}>
            <span className="scene-number">{String(index + 1).padStart(2, "0")}</span>
            <div className="scene-copy">
              <strong>{scene.label}</strong>
              <span>{scene.detail}</span>
            </div>
            <span className="scene-duration">{scene.duration}s</span>
          </li>
        ))}
      </ol>
      {audio?.voiceover || audio?.music ? (
        <div className="storyboard-audio">
          {audio.voiceover ? <p><span className="eyebrow">Voiceover · {audio.voiceover.voice} · {audio.voiceover.seconds.toFixed(1)}s</span>“{audio.voiceover.text}”</p> : null}
          {audio.music ? <p><span className="eyebrow">Music · Lyria</span>{audio.music.prompt}</p> : null}
        </div>
      ) : null}
    </section>
  );
}
