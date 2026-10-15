// Styles for everything Agent Lens draws on Twitch. Shared by all its shadow roots as one stylesheet.
globalThis.AgentLensCSS = `
:host{all:initial; font:13px/1.4 Inter,Roobert,"Helvetica Neue",Helvetica,Arial,sans-serif; -webkit-font-smoothing:antialiased;
  --text:#efeff1; --muted:#adadb8; --button:#2f2f35; --button-hover:#3a3a3d; --line:#2f2f35; --chip-on:#9147ff; --chip-on-hover:#772ce8;
  --side:#1f1f23; --mark:#ff4655; --focus:#a970ff; color:var(--text);}
:host([data-theme="light"]){--text:#0e0e10; --muted:#53535f; --button:#e9e9ec; --button-hover:#dedee3; --line:#e6e6ea; --side:#efeff1; --focus:#772ce8;}
*{box-sizing:border-box}
button{font:inherit; color:inherit; cursor:pointer}
:focus-visible{outline:2px solid var(--focus); outline-offset:2px}
[hidden]{display:none!important}

/* Stream card badge: always on top of a video picture, so always dark. */
.badge{display:inline-flex; align-items:center; gap:6px; height:26px; padding:0 9px 0 3px; border-radius:13px;
  background:rgba(14,14,16,.86); color:#fff; font-weight:600; font-size:12.5px; line-height:1; white-space:nowrap;
  box-shadow:0 1px 3px rgba(0,0,0,.45); backdrop-filter:blur(6px); pointer-events:auto; animation:in .18s ease-out}
.face{width:20px; height:20px; flex:none; border-radius:50%; background:#3a3a3d center/cover no-repeat; box-shadow:inset 0 0 0 1px rgba(255,255,255,.12)}
.score{margin-left:1px; padding-left:7px; border-left:1px solid rgba(255,255,255,.24); font-variant-numeric:tabular-nums; color:#dedee3}
.badge.hot .score{color:#ffd37a}
.badge.earlier{background:rgba(14,14,16,.72); color:#d3d3d9; font-weight:500}
.badge.earlier .face{filter:saturate(.55) brightness(.9)}
.badge.screen{padding-left:9px; background:rgba(14,14,16,.72); color:#d3d3d9; font-weight:500}
.badge.screen .dot{width:6px; height:6px; flex:none; border-radius:50%; background:#8a8a94}
.badge.fav{box-shadow:0 0 0 2px #ffd37a, 0 1px 3px rgba(0,0,0,.45)}
.star{color:#ffd37a; font-size:12px; margin-right:-2px}
.link{width:13px; height:13px; flex:none; color:#8fd3ff; margin-left:-2px}
.chip .link{color:currentColor; margin-left:-3px}
.eye{width:14px; height:14px; flex:none; color:#bf94ff; margin-left:-2px}
.face.eyeface{display:grid; place-items:center; background:#3a3a3d}
.face.eyeface .eye{margin:0; color:#efeff1}
.reading{display:grid; place-items:center; width:26px; height:26px; border-radius:13px; background:rgba(14,14,16,.72); animation:in .18s ease-out}
.reading svg{width:14px; height:14px; animation:pulse 1.2s ease-in-out infinite}
@keyframes pulse{50%{opacity:.35}}
@keyframes in{from{opacity:0; transform:translateY(2px)}}
@media (prefers-reduced-motion:reduce){.badge,.reading{animation:none}.reading svg{animation:none; opacity:.7}}

/* Sidebar: a small agent face on the corner of the streamer's avatar. */
.side{display:block; width:17px; height:17px; border-radius:50%; background:#3a3a3d center/cover no-repeat; box-shadow:0 0 0 2px var(--side)}
.side.earlier{filter:saturate(.55) brightness(.9)}

/* Filter bar on the VALORANT directory. */
.bar{display:flex; flex-direction:column; gap:10px; margin:4px 0 18px; padding:14px 16px; border-radius:6px; background:var(--panel, transparent);
  box-shadow:inset 0 0 0 1px var(--line)}
.head{display:flex; align-items:center; gap:10px; min-height:24px}
.mark{display:grid; place-items:center; width:24px; height:24px; flex:none}
.mark svg{width:22px; height:22px}
.title{font-weight:700; font-size:14px}
.status{color:var(--muted); font-size:12.5px; flex:1; min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap}
.minvbox{display:inline-flex; align-items:center; gap:6px; color:var(--muted); font-size:12.5px; font-weight:600; white-space:nowrap}
.minv{height:26px; padding:0 6px; border:0; border-radius:4px; background:var(--button); color:var(--text); font:inherit; font-size:12.5px; cursor:pointer}
.minv:hover{background:var(--button-hover)}
.clear{height:26px; padding:0 10px; border:0; border-radius:4px; background:transparent; color:var(--muted); font-weight:600; font-size:12.5px}
.clear:hover{background:var(--button); color:var(--text)}
.clear.more{color:var(--text); background:var(--button); flex:none}
.row{display:flex; flex-wrap:wrap; align-items:center; gap:6px}
.label{width:100%; margin:2px 0 -2px; color:var(--muted); font-size:11.5px; font-weight:600; letter-spacing:.02em; text-transform:uppercase}
.chip{display:inline-flex; align-items:center; gap:6px; height:30px; padding:0 11px; border:0; border-radius:15px; background:var(--button); font-weight:600; font-size:13px; white-space:nowrap}
.chip:hover{background:var(--button-hover)}
.chip[aria-pressed="true"]{background:var(--chip-on); color:#fff}
.chip[aria-pressed="true"]:hover{background:var(--chip-on-hover)}
.chip .face{width:22px; height:22px; margin-left:-7px}
.chip .role{width:14px; height:14px; flex:none; background:currentColor; -webkit-mask:var(--icon) center/contain no-repeat; mask:var(--icon) center/contain no-repeat}
.chip .count{min-width:18px; padding:1px 6px; border-radius:9px; background:rgba(0,0,0,.18); font-size:11.5px; font-variant-numeric:tabular-nums; text-align:center}
:host([data-theme="light"]) .chip .count{background:rgba(0,0,0,.08)}
.chip[aria-pressed="true"] .count{background:rgba(255,255,255,.22)}
.chip.dim{opacity:.45}
.chip.star{padding-left:10px}
.sep{width:1px; height:20px; margin:0 4px; background:var(--line)}
.hint,.empty{margin:0; color:var(--muted); font-size:12.5px}
.empty{padding:8px 10px; border-radius:4px; background:var(--button); color:var(--text)}
`;
