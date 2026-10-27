#!/bin/sh
# HyperFrames' streaming encoder pipes every captured frame into one ffmpeg (`-f image2pipe … -i -`). While a scene is drawn
# (scenes.mjs sets SCENE_THUMB), that ffmpeg also writes every SCENE_THUMB_EVERY-th frame, small, over one JPEG the worker
# sends to the page as the scene's latest drawn frame. Same frames, no second capture. Every other ffmpeg call passes through.
if [ -n "$SCENE_THUMB" ]; then
  for arg in "$@"; do
    if [ "$arg" = "image2pipe" ]; then
      exec ffmpeg "$@" -map 0:v -vf "select=not(mod(n\,${SCENE_THUMB_EVERY:-15})),scale=480:-2" -fps_mode passthrough -q:v 5 -update 1 -atomic_writing 1 -y "$SCENE_THUMB"
    fi
  done
fi
exec ffmpeg "$@"
