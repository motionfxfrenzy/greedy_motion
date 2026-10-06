<!doctype html>
<html lang="en" data-composition-variables="__VARS__">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <title>gm-feature-explainer</title>
    <script src="vendor/gsap.min.js"></script>
    <link rel="stylesheet" href="assets/explainer.css" />
    <style>
      body { margin: 0; background: #EBF5FF; }
    </style>
  </head>
  <body>
    <!-- no data-duration: the length is inferred from the timeline (timing.total) and the mix, so a new VO re-times the film with no HTML edit -->
    <div id="root" data-composition-id="main" data-start="0" data-width="1920" data-height="1080">
      <div id="stage" class="grp" data-layout-allow-overflow></div>
      <svg id="cursor" viewBox="0 0 24 24" data-layout-allow-overflow><path d="M5 3 L5 19.6 L9.2 15.6 L12 21.8 L15.1 20.4 L12.4 14.4 L18.3 14.4 Z" fill="#1c1c1c" stroke="#ffffff" stroke-width="1.4" stroke-linejoin="round" /></svg>
      <audio id="mix" src="assets/audio/mix.wav" data-start="0" data-track-index="2" data-volume="1"></audio>
    </div>
    <script>
/* engine.js (minified, inlined by tools/pipeline.py index): builds the one paused timeline from the variables */
__ENGINE__
      window.__timelines["main"] = window.__fxTimeline;
    </script>
  </body>
</html>
