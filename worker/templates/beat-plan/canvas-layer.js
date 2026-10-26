/* Bounded procedural geometry. Called by the shared film clock, never an independent RAF. */
function canvasFigure(parent, beat, start, end) {
  var wide = MODE === "wide";
  var size = Math.round(Math.min(W * (wide ? .30 : .58), H * (wide ? .68 : .31)));
  var canvas = document.createElement("canvas");
  canvas.className = "procedural-figure";
  canvas.setAttribute("aria-hidden", "true");
  // Capture pixels never exceed the logical composition resolution (no unbounded devicePixelRatio).
  canvas.width = canvas.height = size;
  Object.assign(canvas.style, {position:"absolute",left:px(wide ? W*.67 : (W-size)/2),top:px(wide ? (H-size)/2 : H*.62),width:px(size),height:px(size)});
  parent.appendChild(canvas);
  var ctx = canvas.getContext("2d", {alpha:true});
  if (!ctx) throw new Error("Canvas 2D is unavailable for scene " + beat.id);
  var seed = seedOf(beat.id), points = [];
  function random() { seed = (Math.imul(seed,1664525)+1013904223)>>>0; return seed/4294967296; }
  for (var i=0;i<96;i++) points.push({angle:random()*Math.PI*2,radius:.14+random()*.30,speed:.15+random()*.4,r:1.5+random()*3});
  var ink = tok("--fg"), accent = tok("--brand"), lastTime = null;
  var stats = {id:beat.id,draws:0,skips:0,points:points.length,pixels:size*size};
  LOG.canvas.push(stats);
  CANVAS_LAYERS.push(function(time) {
    // Include seam preroll. Re-entering at the same pose may safely reuse its cached bitmap.
    if (time < Math.max(0,start-OV) || time > end || time === lastTime) {stats.skips++;return;}
    lastTime=time;stats.draws++;
    var local=Math.max(0,time-start), p=clamp(local/Math.min(.65,(end-start)*.3),0,1), ease=1-Math.pow(1-p,3);
    ctx.clearRect(0,0,size,size);ctx.save();ctx.translate(size/2,size/2);ctx.scale(ease,ease);
    ctx.strokeStyle=ink;ctx.fillStyle=accent;ctx.lineWidth=Math.max(1,size*.003);
    if(beat.route.graphic === "particles") {
      points.forEach(function(q){var a=q.angle+local*q.speed,r=size*q.radius;ctx.beginPath();ctx.arc(Math.cos(a)*r,Math.sin(a)*r,q.r,0,Math.PI*2);ctx.fill();});
    } else {
      for(var j=0;j<3;j++){ctx.save();ctx.rotate(j*Math.PI/3+local*.18);ctx.beginPath();ctx.ellipse(0,0,size*.39,size*.15,0,0,Math.PI*2);ctx.stroke();var a=local*(.8+j*.12)+j;ctx.beginPath();ctx.arc(Math.cos(a)*size*.39,Math.sin(a)*size*.15,size*.027,0,Math.PI*2);ctx.fill();ctx.restore();}
      ctx.beginPath();ctx.arc(0,0,size*.065,0,Math.PI*2);ctx.fill();
    }
    ctx.restore();
  });
}
