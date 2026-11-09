"use client";
import { useId, type RefObject } from "react";
import { affectedScenesSummary, formatClock } from "./logic";
import { ProgressButton } from "./ProgressButton";
import type { WorkspaceComment } from "./types";

export interface CommentsPanelProps {
  currentTime: number;
  currentSceneIndex: number;
  currentSceneKeyword?: string;
  hasCurrentScene: boolean;
  comments: readonly WorkspaceComment[];
  draft: string;
  onChangeDraft: (draft: string) => void;
  onFocusDraft?: () => void;
  canAdd: boolean;
  adding?: boolean;
  onAddComment: () => void;
  onRemoveComment: (id: string) => void;
  onSeekToComment: (seconds: number) => void;
  onApply: () => void;
  applying?: boolean;
  applyProgress?: number | null;
  applyBusyLabel?: string;
  applyIdleEmptyLabel?: string;
  applyPrefix?: string;
  note?: string;
  onRender?: () => void;
  rendering?: boolean;
  renderDisabled?: boolean;
  renderTitle?: string;
  cost?: number;
  renderButtonRef?: RefObject<HTMLButtonElement | null>;
}

/**
 * Right-hand workspace column:
 * Primary `Render · N tokens` action at the top, followed by the timed `Comments` panel
 * (`At 0:03` + `Scene N` chips, textarea composer, comment list with time jump and remove buttons,
 * and the `Redraw scene(s)` / apply button).
 */
export function CommentsPanel({
  currentTime,
  currentSceneIndex,
  currentSceneKeyword,
  hasCurrentScene,
  comments,
  draft,
  onChangeDraft,
  onFocusDraft,
  canAdd,
  adding = false,
  onAddComment,
  onRemoveComment,
  onSeekToComment,
  onApply,
  applying = false,
  applyProgress = null,
  applyBusyLabel = "Drawing…",
  applyIdleEmptyLabel = "Redraw with comments",
  applyPrefix = "Redraw",
  note = "Only the scenes you comment on are redrawn.",
  onRender,
  rendering = false,
  renderDisabled = false,
  renderTitle,
  cost,
  renderButtonRef
}: CommentsPanelProps) {
  const renderDescId = useId();
  const applySummary = affectedScenesSummary(comments, {
    busy: applying,
    busyLabel: applyBusyLabel,
    emptyLabel: applyIdleEmptyLabel,
    actionVerb: applyPrefix
  });

  return (
    <div className="aw-right-col">
      {onRender && (
        <>
          <button
            ref={renderButtonRef}
            type="button"
            className="primary-button aw-render-top"
            disabled={Boolean(rendering || renderDisabled)}
            title={renderTitle}
            aria-describedby={renderDescId}
            onClick={onRender}
          >
            <span>{rendering ? "Rendering…" : "Render"}</span>
            {cost != null && !rendering && <small>{cost} tokens</small>}
          </button>
          <span id={renderDescId} className="sr-only">
            If scenes are still being built or you haven&apos;t watched the preview through, you&apos;ll be asked to confirm before making the video.
          </span>
        </>
      )}
      <aside className="aw-side" aria-label="Comments">
        <header>
          <b>Comments</b>
          <span>{comments.length ? `${comments.length}` : ""}</span>
        </header>
        <div className="aw-at">
          <span>At {formatClock(currentTime)}</span>
          {hasCurrentScene && (
            <span>
              Scene {currentSceneIndex + 1} · {currentSceneKeyword}
            </span>
          )}
        </div>
        <div className="aw-compose">
          <textarea
            value={draft}
            maxLength={600}
            rows={3}
            placeholder="What should change here? e.g. the girl should look up, make the sun bigger"
            aria-label="Comment"
            onFocus={onFocusDraft}
            onChange={(e) => onChangeDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                void onAddComment();
              }
            }}
          />
          <button
            className="primary-button"
            disabled={!draft.trim() || adding || !canAdd}
            onClick={() => void onAddComment()}
          >
            Add
          </button>
        </div>
        <ul className="aw-comments">
          {comments.length === 0 && (
            <li className="empty">Comments you add are pinned to this moment of the film.</li>
          )}
          {comments.map((comment) => {
            const canUndo = Boolean(comment.appliedLabel && comment.appliedEl);
            const timeLabel = formatClock(comment.at);
            return (
              <li key={comment.id}>
                <button
                  type="button"
                  className="aw-time"
                  onClick={() => onSeekToComment(comment.at)}
                  title="Go to this moment"
                >
                  {timeLabel}
                </button>
                <p>
                  {comment.body}
                  <small
                    role="status"
                    className={comment.refusedReason && !comment.appliedLabel ? "aw-comment-refused" : undefined}
                  >
                    Scene {comment.scene + 1}
                    {comment.appliedLabel
                      ? ` · ${comment.appliedLabel}`
                      : comment.refusedReason
                      ? ` · ${comment.refusedReason}`
                      : ""}
                  </small>
                </p>
                <button
                  type="button"
                  className="aw-x"
                  disabled={applying}
                  aria-label={
                    canUndo
                      ? `Undo comment edit (${timeLabel}: ${comment.body})`
                      : `Remove comment (${timeLabel}: ${comment.body})`
                  }
                  title={canUndo ? "Undo this change" : "Remove comment"}
                  onClick={() => void onRemoveComment(comment.id)}
                >
                  ×
                </button>
              </li>
            );
          })}
        </ul>
        <ProgressButton
          className="primary-button aw-apply"
          disabled={!applySummary.scenes.length || applying}
          busy={applying}
          progress={applyProgress}
          onClick={() => void onApply()}
        >
          {applySummary.label}
        </ProgressButton>
        <p className="aw-note">{note}</p>
      </aside>
    </div>
  );
}
