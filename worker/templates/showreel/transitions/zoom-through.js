  TR["zoom-through"] = (o, i, t, d) => {       // the outgoing scene is on top, rushes at the camera and fades out; the next scene settles underneath it
    tl.fromTo(o, { zIndex: 40 }, { zIndex: 40, duration: d, ease: "none" }, t);
    tl.fromTo(o, { scale: 1, opacity: 1, filter: blur(0) }, { scale: 3.2, opacity: 0, filter: blur(P.blur * 0.7), duration: d, ease: E.in }, t);
    tl.fromTo(i, { scale: 1.25, filter: blur(P.blur * 0.4) }, { scale: 1, filter: blur(0), duration: d, ease: E.out }, t);
  };
