<!doctype html>
<!-- verification harness (not a composition): runs engine.js with the project's variables and exposes window.__fx -->
<meta charset="utf-8">
<link rel="stylesheet" href="../assets/explainer.css">
<script src="../vendor/gsap.min.js"></script>
<script>
  window.__timelines = {};
  window.__hyperframes = { getVariables: function () { return __VARS__; } };
</script>
<div id="root" data-composition-id="main" style="width:1920px;height:1080px">
  <div id="stage" class="grp"></div>
  <svg id="cursor" viewBox="0 0 24 24"></svg>
</div>
<script src="../engine.js"></script>
