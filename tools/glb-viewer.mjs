#!/usr/bin/env node
// GLB Viewer — run with: node tools/glb-viewer.mjs
// Serves three.js from local node_modules so no CDN or internet needed.

import http from 'http';
import fs   from 'fs';
import path from 'path';
import { exec }     from 'child_process';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const PORT    = 7777;
const ROOT    = path.join(__dirname, '..');
const NM      = path.join(ROOT, 'node_modules');

const MIME = {
  '.html': 'text/html',
  '.js':   'application/javascript',
  '.glb':  'model/gltf-binary',
  '.gltf': 'model/gltf+json',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
};

const HTML = /* html */`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>GLB Viewer</title>
<script type="importmap">
{
  "imports": {
    "three": "/nm/three/build/three.module.js",
    "three/addons/": "/nm/three/examples/jsm/"
  }
}
</script>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { display: flex; height: 100vh; background: #1a1a2e; color: #e0e0e0; font-family: monospace; font-size: 13px; overflow: hidden; }
  #canvas-wrap { flex: 1; min-width: 0; position: relative; display: flex; }
  #drop-hint {
    position: absolute; inset: 8px; z-index: 10; pointer-events: none;
    border: 2px dashed #3a3a6a; border-radius: 6px;
    display: flex; align-items: flex-end; justify-content: center;
    padding-bottom: 14px; color: #3a3a6a; font-size: 13px;
  }
  #canvas-wrap.has-model #drop-hint { display: none; }
  #drag-overlay {
    display: none; position: fixed; inset: 0; z-index: 100;
    background: rgba(100,100,255,0.15); border: 4px dashed #8888ff;
    align-items: center; justify-content: center;
    font-size: 28px; color: #8888ff; pointer-events: none;
  }
  #drag-overlay.active { display: flex; }
  #viewport { flex: 1; display: block; width: 100%; height: 100%; cursor: grab; }
  #viewport:active { cursor: grabbing; }
  #panel {
    width: 270px; background: #0f0f1a; border-left: 1px solid #333;
    display: flex; flex-direction: column; overflow-y: auto; padding: 12px; gap: 8px;
  }
  h3 { color: #8888ff; font-size: 11px; text-transform: uppercase; letter-spacing: 1px; }
  .row { display: flex; align-items: center; gap: 6px; }
  .row label { width: 72px; color: #aaa; flex-shrink: 0; font-size: 12px; }
  .row input[type=range] { flex: 1; accent-color: #8888ff; }
  .row .val { width: 44px; text-align: right; color: #fff; font-size: 12px; cursor: pointer; }
  .row .val:hover { color: #8888ff; text-decoration: underline dotted; }
  .row .val[title]::after { content: ''; }
  .section { border-top: 1px solid #222; padding-top: 8px; display: flex; flex-direction: column; gap: 5px; }
  button {
    width: 100%; padding: 6px; background: #2a2a4a; border: 1px solid #444;
    color: #e0e0e0; cursor: pointer; border-radius: 4px; font-family: monospace; font-size: 12px;
  }
  button:hover { background: #3a3a6a; }
  #open-btn { background: #1a2a4a; border-color: #4466aa; color: #88aaff; padding: 10px; font-size: 13px; }
  #open-btn:hover { background: #2a3a6a; }
  #info { color: #888; font-size: 11px; line-height: 1.6; word-break: break-all; }
  #copy-btn { background: #1a3a1a; border-color: #3a7a3a; color: #7fff7f; }
  #copy-btn:hover { background: #2a4a2a; }
  #preview-btn.active { background: #2a1a4a; border-color: #8844aa; color: #cc88ff; }
  select, input[type=text] { background: #2a2a4a; border: 1px solid #444; color: #e0e0e0; padding: 4px; border-radius: 4px; width: 100%; font-family: monospace; font-size: 12px; }
  #status { color: #aaa; font-size: 11px; text-align: center; padding: 4px 0; min-height: 18px; }
  /* Meeting preview overlay */
  #meeting-frame {
    display: none; position: absolute; z-index: 20; pointer-events: none;
    border-radius: 14px; border: 2px solid rgba(137,87,229,0.6);
    box-shadow: 0 0 0 9999px rgba(10,10,20,0.72);
  }
  #canvas-wrap.show-preview #meeting-frame { display: block; }
</style>
</head>
<body>
<div id="canvas-wrap">
  <canvas id="viewport"></canvas>
  <div id="meeting-frame"></div>
  <div id="drop-hint">⬇ Drop .glb here &nbsp;|&nbsp; use Open button →</div>
  <div id="drag-overlay">Drop GLB here</div>
</div>
<div id="panel">
  <button id="open-btn">📂 Open GLB…</button>
  <input type="file" accept=".glb" id="file-input" style="display:none">
  <div id="status">No model loaded</div>

  <div class="section">
    <h3>Avatar info</h3>
    <div class="row"><label>Name</label><input type="text" id="av-name" placeholder="e.g. Jordan"></div>
    <div class="row"><label>Sex</label>
      <select id="av-sex"><option value="male">male</option><option value="female">female</option></select>
    </div>
  </div>

  <div class="section">
    <h3>Background</h3>
    <select id="bg-select">
      <option value="#1a1a2e">Dark blue</option>
      <option value="#111111">Black</option>
      <option value="#ffffff">White</option>
      <option value="#888888">Mid grey</option>
      <option value="checker">Checker</option>
    </select>
  </div>

  <div class="section">
    <h3>Camera position</h3>
    <div class="row"><label>X</label><input type="range" id="cam-x" min="-20" max="20" value="0" step="0.05"><span class="val" id="cam-x-v">0.00</span></div>
    <div class="row"><label>Y</label><input type="range" id="cam-y" min="-20" max="20" value="1.7" step="0.05"><span class="val" id="cam-y-v">1.70</span></div>
    <div class="row"><label>Z</label><input type="range" id="cam-z" min="0.1" max="20" value="0.5" step="0.05"><span class="val" id="cam-z-v">0.50</span></div>
    <div class="row"><label>FOV</label><input type="range" id="fov" min="10" max="90" value="50" step="1"><span class="val" id="fov-v">50</span></div>
  </div>

  <div class="section">
    <h3>Rotation (deg)</h3>
    <div class="row"><label>X</label><input type="range" id="rx" min="-180" max="180" value="0" step="0.5"><span class="val" id="rx-v">0</span></div>
    <div class="row"><label>Y</label><input type="range" id="ry" min="-180" max="180" value="0" step="0.5"><span class="val" id="ry-v">0</span></div>
    <div class="row"><label>Z</label><input type="range" id="rz" min="-180" max="180" value="0" step="0.5"><span class="val" id="rz-v">0</span></div>
  </div>

  <div class="section">
    <h3>Scale</h3>
    <div class="row"><label>Uniform</label><input type="range" id="scale" min="0.05" max="5" value="1" step="0.05"><span class="val" id="scale-v">1.00</span></div>
  </div>

  <div class="section">
    <button id="preview-btn">Show meeting preview</button>
    <button id="reset-btn">Reset all</button>
    <button id="copy-btn">Copy avatars.json entry</button>
  </div>

  <div class="section">
    <div id="info"></div>
  </div>
</div>

<script type="module">
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const canvas   = document.getElementById('viewport');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene  = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.001, 100);
scene.background = new THREE.Color('#1a1a2e');

scene.add(new THREE.AmbientLight(0xffffff, 0.8));
const dir = new THREE.DirectionalLight(0xffffff, 0.6); dir.position.set(1,2,2); scene.add(dir);
const fill = new THREE.DirectionalLight(0xffffff, 0.3); fill.position.set(-1,0,1); scene.add(fill);

// Apply camera position matching the app: lookAt(cx, cy-0.08, 0)
function applyCamera() {
  const cx = getCamX(), cy = getCamY(), cz = getCamZ();
  camera.position.set(cx, cy, cz);
  camera.lookAt(new THREE.Vector3(cx, cy - 0.08, 0));
  camera.fov = getFov();
  camera.updateProjectionMatrix();
}

function resize() {
  const w = canvas.clientWidth, h = canvas.clientHeight;
  if (canvas.width !== w || canvas.height !== h) {
    renderer.setSize(w, h, false); camera.aspect = w/h; camera.updateProjectionMatrix();
  }
}

function makeChecker() {
  const s=64, c=document.createElement('canvas'); c.width=c.height=s;
  const ctx=c.getContext('2d');
  for(let y=0;y<s;y+=8) for(let x=0;x<s;x+=8){ctx.fillStyle=((x+y)/8%2===0)?'#2a2a2a':'#1a1a1a';ctx.fillRect(x,y,8,8);}
  const t=new THREE.CanvasTexture(c); t.wrapS=t.wrapT=THREE.RepeatWrapping; t.repeat.set(20,20); return t;
}

let model = null, currentFile = null;

// sl(id, vid, decimals, defaultVal, callback)
// Double-clicking the value label resets to defaultVal.
function sl(id, vid, dec, def, cb) {
  const el=document.getElementById(id), vl=document.getElementById(vid);
  vl.title = 'Double-click to reset to ' + Number(def).toFixed(dec);
  const fire = v => { vl.textContent=Number(v).toFixed(dec); cb(v); };
  el.addEventListener('input', () => fire(parseFloat(el.value)));
  vl.addEventListener('dblclick', () => { el.value=def; fire(def); });
  return () => parseFloat(el.value);
}

const getRx    = sl('rx',    'rx-v',    0, 0,   v=>model&&(model.rotation.x=THREE.MathUtils.degToRad(v)));
const getRy    = sl('ry',    'ry-v',    0, 0,   v=>model&&(model.rotation.y=THREE.MathUtils.degToRad(v)));
const getRz    = sl('rz',    'rz-v',    0, 0,   v=>model&&(model.rotation.z=THREE.MathUtils.degToRad(v)));
const getScale = sl('scale', 'scale-v', 2, 1,   v=>model&&model.scale.setScalar(v));
const getCamX  = sl('cam-x', 'cam-x-v', 2, 0,   ()=>applyCamera());
const getCamY  = sl('cam-y', 'cam-y-v', 2, 1.7, ()=>applyCamera());
const getCamZ  = sl('cam-z', 'cam-z-v', 2, 0.5, ()=>applyCamera());
const getFov   = sl('fov',   'fov-v',   0, 50,  ()=>applyCamera());

// Seed initial camera
applyCamera();

// Mouse wheel on canvas adjusts cam-z (zoom)
canvas.addEventListener('wheel', e => {
  e.preventDefault();
  const el  = document.getElementById('cam-z');
  const vl  = document.getElementById('cam-z-v');
  const step = parseFloat(el.step) || 0.01;
  const val  = Math.max(parseFloat(el.min), Math.min(parseFloat(el.max),
                 parseFloat(el.value) + (e.deltaY > 0 ? step * 5 : -step * 5)));
  el.value = val;
  vl.textContent = val.toFixed(2);
  applyCamera();
}, { passive: false });

document.getElementById('bg-select').addEventListener('change', e=>{
  scene.background = e.target.value==='checker' ? makeChecker() : new THREE.Color(e.target.value);
});

document.getElementById('reset-btn').addEventListener('click',()=>{
  [['rx',0,0],['ry',0,0],['rz',0,0],['scale',1,2],['cam-x',0,2],['cam-y',1.7,2],['cam-z',0.5,2],['fov',50,0]].forEach(([id,v,dec])=>{
    const el=document.getElementById(id), vl=document.getElementById(id+'-v');
    el.value=v; vl.textContent=Number(v).toFixed(dec);
  });
  if(model){model.rotation.set(0,0,0);model.scale.setScalar(1);}
  applyCamera();
});

document.getElementById('copy-btn').addEventListener('click',()=>{
  const name = document.getElementById('av-name').value.trim() || 'Unknown';
  const entry = {
    name,
    sex:    document.getElementById('av-sex').value,
    file:   currentFile || 'model.glb',
    camera: [+getCamX().toFixed(3), +getCamY().toFixed(3), +getCamZ().toFixed(3)],
    rotate: [+getRx().toFixed(1), +getRy().toFixed(1), +getRz().toFixed(1)],
    fov:    +getFov().toFixed(0),
    scale:  +getScale().toFixed(3),
  };
  navigator.clipboard.writeText(JSON.stringify(entry, null, 4));
  document.getElementById('copy-btn').textContent='✓ Copied!';
  setTimeout(()=>document.getElementById('copy-btn').textContent='Copy avatars.json entry',1500);
});

// Meeting preview overlay — square frame centred on canvas
const canvasWrap  = document.getElementById('canvas-wrap');
const meetingFrame = document.getElementById('meeting-frame');
let previewOn = false;

function updatePreviewFrame() {
  if (!previewOn) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  const size = Math.round(Math.min(cw, ch) * 0.72);
  const left = Math.round((cw - size) / 2);
  const top  = Math.round((ch - size) / 2);
  meetingFrame.style.width  = size + 'px';
  meetingFrame.style.height = size + 'px';
  meetingFrame.style.left   = left + 'px';
  meetingFrame.style.top    = top  + 'px';
}

document.getElementById('preview-btn').addEventListener('click', () => {
  previewOn = !previewOn;
  canvasWrap.classList.toggle('show-preview', previewOn);
  document.getElementById('preview-btn').classList.toggle('active', previewOn);
  document.getElementById('preview-btn').textContent = previewOn ? 'Hide meeting preview' : 'Show meeting preview';
  if (previewOn) updatePreviewFrame();
});

const loader = new GLTFLoader();
function loadGLB(url, name) {
  currentFile = name;
  if(model){scene.remove(model);model=null;}
  document.getElementById('status').textContent='Loading…';
  document.getElementById('info').textContent='';
  loader.load(url, gltf=>{
    model=gltf.scene;
    model.rotation.set(THREE.MathUtils.degToRad(getRx()),THREE.MathUtils.degToRad(getRy()),THREE.MathUtils.degToRad(getRz()));
    model.scale.setScalar(getScale());
    scene.add(model);

    // Auto-frame: compute bounding sphere and position camera to fit
    const box = new THREE.Box3().setFromObject(model);
    const sphere = new THREE.Sphere();
    box.getBoundingSphere(sphere);
    const center = sphere.center;
    const r = sphere.radius;
    // Place camera in front of model centre, far enough to see it all
    const fovRad = THREE.MathUtils.degToRad(getFov());
    const dist = (r / Math.tan(fovRad / 2)) * 1.2;
    const cx = +center.x.toFixed(3);
    const cy = +center.y.toFixed(3);
    const cz = +(center.z + dist).toFixed(3);
    // Sync sliders
    const setSlider = (id, v, dec) => {
      const el = document.getElementById(id);
      el.value = v;
      document.getElementById(id + '-v').textContent = Number(v).toFixed(dec);
    };
    setSlider('cam-x', cx, 2);
    setSlider('cam-y', cy, 2);
    setSlider('cam-z', cz, 2);
    applyCamera();

    const meshes=[],morphMeshes=[];
    model.traverse(n=>{
      if(n.isMesh||n.isSkinnedMesh){
        meshes.push(n.name||'(unnamed)');
        if(n.morphTargetDictionary&&Object.keys(n.morphTargetDictionary).length)
          morphMeshes.push('<b>'+(n.name||'mesh')+'</b>:<br>'+Object.keys(n.morphTargetDictionary).join(', '));
      }
    });
    const sz=box.getSize(new THREE.Vector3()), ctr=center;
    document.getElementById('canvas-wrap').classList.add('has-model');
    document.getElementById('status').textContent='✓ '+name;
    document.getElementById('info').innerHTML=
      'Size: '+sz.x.toFixed(2)+' × '+sz.y.toFixed(2)+' × '+sz.z.toFixed(2)+'<br>'+
      'Center: ('+ctr.x.toFixed(2)+', '+ctr.y.toFixed(2)+', '+ctr.z.toFixed(2)+')<br>'+
      'Meshes: '+meshes.join(', ')+'<br><br>'+
      (morphMeshes.length?'<b>Morph targets:</b><br>'+morphMeshes.join('<br><br>'):'<i>No morph targets</i>');
  }, undefined, err=>{
    document.getElementById('status').textContent='✗ Error';
    document.getElementById('info').textContent=err.message;
  });
}

const fileInput = document.getElementById('file-input');
document.getElementById('open-btn').addEventListener('click',()=>fileInput.click());
fileInput.addEventListener('change',e=>{ const f=e.target.files[0]; if(f) loadGLB(URL.createObjectURL(f),f.name); });

const overlay = document.getElementById('drag-overlay');
document.addEventListener('dragenter', e=>{ e.preventDefault(); overlay.classList.add('active'); });
document.addEventListener('dragover',  e=>e.preventDefault());
document.addEventListener('dragleave', e=>{ if(!e.relatedTarget) overlay.classList.remove('active'); });
document.addEventListener('drop', e=>{
  e.preventDefault(); overlay.classList.remove('active');
  const f=e.dataTransfer.files[0]; if(f) loadGLB(URL.createObjectURL(f),f.name);
});

(function animate(){ requestAnimationFrame(animate); resize(); updatePreviewFrame(); renderer.render(scene,camera); })();
</script>
</body>
</html>`;

// ── HTTP server ───────────────────────────────────────────────────────────────

const server = http.createServer((req, res) => {
  const url = req.url.split('?')[0];

  // Serve the viewer HTML
  if (url === '/' || url === '/index.html') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    return res.end(HTML);
  }

  // Serve node_modules under /nm/
  if (url.startsWith('/nm/')) {
    const rel  = url.slice(4); // strip /nm/
    const file = path.join(NM, rel);
    // Safety: don't escape outside node_modules
    if (!file.startsWith(NM)) { res.writeHead(403); return res.end(); }
    fs.readFile(file, (err, data) => {
      if (err) { res.writeHead(404); return res.end('Not found'); }
      const ext = path.extname(file);
      res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream' });
      res.end(data);
    });
    return;
  }

  res.writeHead(404); res.end();
});

server.listen(PORT, '127.0.0.1', () => {
  const url = `http://localhost:${PORT}`;
  console.log(`GLB Viewer running at ${url}`);
  // Open browser (Windows)
  exec(`start ${url}`);
});
