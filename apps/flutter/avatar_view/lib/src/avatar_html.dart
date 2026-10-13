import 'dart:convert';

import 'avatar_config.dart';

/// The page the avatar WebView runs.
///
/// Kept as a pure function of its inputs so it can be diffed and tested
/// without a WebView. Two things it pulls from the server rather than
/// bundling:
///
///  * `avatar-core.js` and `morph-lipsync.js` — the viseme mapping, rest pose,
///    blink and idle motion, shared with the browser dashboard so a fix to lip
///    sync lands in both at once.
///  * three.js and `@pixiv/three-vrm` from a CDN, which is why the avatar needs
///    a connection even for a model it has already downloaded.
String buildAvatarHtml({
  required String src,
  AvatarConfig? config,
  String? moduleOrigin,
  Map<String, String> headers = const {},
  bool interactive = false,
}) {
  final cfg = config ?? const AvatarConfig();
  final srcEsc = jsonEncode(src);
  final headersEsc = jsonEncode(headers);
  final origin = moduleOrigin ?? Uri.parse(src).origin;
  final targetY = cfg.cameraY;
  final orbitZ = cfg.cameraZ;
  final fov = cfg.fov;
  final rotY = (cfg.rotateY * 3.14159265 / 180.0).toStringAsFixed(6);
  final orbit = interactive ? 'true' : 'false';

  return '''<!DOCTYPE html>
<html>
<head>
<meta name="viewport" content="width=device-width,initial-scale=1,user-scalable=no">
<style>
*{margin:0;padding:0;box-sizing:border-box}
html,body{width:100%;height:100%;background:transparent;overflow:hidden}
canvas{position:fixed;top:0;left:0;width:100%;height:100%}
</style>
</head>
<body>
<!-- Pre-module queue: Dart may call _queueLipSync before the ES module executes. -->
<script>
window._pendingLip = null;
window._queueLipSync = function(v) { window._pendingLip = v; };
</script>

<script type="module">
import * as THREE from 'https://esm.sh/three@0.174.0';
import { GLTFLoader }    from 'https://esm.sh/three@0.174.0/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'https://esm.sh/three@0.174.0/examples/jsm/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.0?deps=three@0.174.0';
import { VISEME_TO_VRM, VRM_VOWELS, applyVrmRestPose, applyGlbRestPose, stepIdleMotion,
         makeBlink, stepBlink, collectBlinkMeshes, applyBlinkMeshes }
  from '$origin/modules/avatar-core.js';
import { collectVisemeMeshes, stepMorphWeights, applyMorphWeights }
  from '$origin/morph-lipsync.js';

const clock = new THREE.Clock();

// ── Renderer ──────────────────────────────────────────────────────────────
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);
document.body.appendChild(renderer.domElement);

new ResizeObserver(() => {
  const w = window.innerWidth, h = window.innerHeight;
  if (w > 0 && h > 0) {
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
}).observe(document.documentElement);

// ── Scene & lights ────────────────────────────────────────────────────────
const scene = new THREE.Scene();
scene.add(new THREE.AmbientLight(0xffffff, 1.5));
const sun = new THREE.DirectionalLight(0xffffff, 2.0);
sun.position.set(1, 1, 1).normalize();
scene.add(sun);

// ── Camera & controls ─────────────────────────────────────────────────────
const TY = $targetY, TZ = $orbitZ;
const camera = new THREE.PerspectiveCamera($fov, window.innerWidth / window.innerHeight, 0.01, 100);
camera.position.set(0, TY, TZ);
camera.lookAt(0, TY - 0.08, 0);

// The camera is framed by the avatar catalogue on the runner, and on a
// phone a drag is usually a finger that was aiming at the transcript behind
// it. So the controls are off unless something asks for them.
const INTERACTIVE = $orbit;
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, TY - 0.08, 0);
controls.minDistance = 0.05;
controls.maxDistance = 3.0;
controls.enablePan = false;
controls.enableRotate = INTERACTIVE;
controls.enableZoom = INTERACTIVE;
controls.update();

// ── State ─────────────────────────────────────────────────────────────────
let vrm          = null;
let vrmWeights   = {};
let vrmElapsed   = 0;
let blink        = makeBlink();
let mixer        = null;        // AnimationMixer for GLB idle clips
let visemeMeshes = [];          // GLB meshes with viseme_* morph targets
let blinkMeshes  = [];          // GLB meshes with eyeBlinkLeft/Right morph targets
const morphWeights = {};        // GLB morph weight lerp state

let lipData     = null;         // [{viseme,start,end}] or null
let lipFallback = false;        // true = no visemes, use oscillation fallback
let lipT0       = null;         // performance.now() at chunk start
let pendingLip  = null;         // queued while model loads
let modelLoaded = false;

// ── Model load ────────────────────────────────────────────────────────────
const loader = new GLTFLoader();
loader.register(p => new VRMLoaderPlugin(p));
// The Embodiment API authenticates /api/*, and the avatar lives there. The
// WebView carries no cookie, so the key has to ride on the request itself.
loader.setRequestHeader($headersEsc);

function _unloadModel() {
  scene.children.filter(c => !c.isLight).forEach(c => scene.remove(c));
  vrm = null; vrmWeights = {}; vrmElapsed = 0; blink = makeBlink();
  if (mixer) { mixer.stopAllAction(); mixer = null; }
  visemeMeshes = []; blinkMeshes = []; Object.keys(morphWeights).forEach(k => delete morphWeights[k]);
  lipData = null; lipFallback = false; lipT0 = null; pendingLip = null;
  modelLoaded = false;
}

window.loadModel = function(url) {
  _unloadModel();
  loader.load(url, gltf => {
    const v = gltf.userData.vrm;
    if (v) {
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      vrm = v;
      applyVrmRestPose(vrm);
      blink = makeBlink();
      console.log('[Avatar] VRM expressions:', Object.keys(vrm.expressionManager?.expressionMap ?? {}).join(', ') || '(none)');
    } else {
      visemeMeshes = collectVisemeMeshes(gltf.scene);
      blinkMeshes  = collectBlinkMeshes(gltf.scene);
      blink = makeBlink();
      applyGlbRestPose(gltf.scene);
      if (gltf.animations?.length > 0) {
        mixer = new THREE.AnimationMixer(gltf.scene);
        for (const clip of gltf.animations) mixer.clipAction(clip).play();
        console.log('[Avatar] GLB idle animations:', gltf.animations.length);
      }
      console.log('[Avatar] GLB viseme meshes:', visemeMeshes.length, 'blink meshes:', blinkMeshes.length);
    }
    gltf.scene.rotation.y = $rotY;
    scene.add(gltf.scene);
    modelLoaded = true;
    window.AvatarBridge?.postMessage('ready');
    if (pendingLip !== null) { _startLipSync(pendingLip); pendingLip = null; }
  }, undefined, e => {
    console.error('[Avatar] load error', e);
    modelLoaded = true;
    window.AvatarBridge?.postMessage('error');
  });
};

window.loadModel($srcEsc);

// ── Lip-sync ──────────────────────────────────────────────────────────────
function _startLipSync(visemes) {
  lipT0       = performance.now();
  lipData     = visemes.length > 0 ? visemes : null;
  lipFallback = visemes.length === 0;
  console.log('[LipSync] start visemes:', visemes.length, 'vrm:', !!vrm, 'glbMeshes:', visemeMeshes.length);
}

window._queueLipSync = function(visemes) {
  if (!modelLoaded) { pendingLip = visemes; return; }
  _startLipSync(visemes);
};

if (window._pendingLip !== null) {
  window._queueLipSync(window._pendingLip);
  window._pendingLip = null;
}

// ── Render loop ───────────────────────────────────────────────────────────
function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  // Determine the current viseme from elapsed time since chunk start.
  let currentViseme = 'viseme_sil';
  if (lipT0 !== null) {
    const t = (performance.now() - lipT0) / 1000;
    if (lipData) {
      const cur = lipData.find(v => t >= v.start && t < v.end);
      currentViseme = cur ? cur.viseme : 'viseme_sil';
      const last = lipData[lipData.length - 1];
      if (last && t > last.end + 0.4) { lipData = null; lipT0 = null; }
    } else if (lipFallback) {
      // No phoneme data — alternate open/closed at ~2.8 Hz for up to 4 s.
      currentViseme = Math.floor(t / 0.18) % 2 === 0 ? 'viseme_aa' : 'viseme_sil';
      if (t > 4.0) { lipFallback = false; lipT0 = null; }
    } else {
      lipT0 = null;
    }
  }

  // ── VRM path ─────────────────────────────────────────────────────────────
  if (vrm) {
    vrmElapsed += delta;
    stepIdleMotion(vrm, vrmElapsed);

    const em = vrm.expressionManager;
    if (em) {
      const target = VISEME_TO_VRM[currentViseme] ?? {};
      for (const v of VRM_VOWELS) {
        const want = target[v] ?? 0;
        const cur  = vrmWeights[v] ?? 0;
        vrmWeights[v] = cur + (want - cur) * 0.35;
        em.setValue(v, vrmWeights[v]);
      }
      stepBlink(blink, v => em.setValue('blink', v), delta);
    }
    vrm.update(delta);
  }

  // ── GLB path ──────────────────────────────────────────────────────────────
  if (mixer) mixer.update(delta);
  if (visemeMeshes.length > 0) {
    stepMorphWeights(morphWeights, currentViseme);
    applyMorphWeights(visemeMeshes, morphWeights);
  }
  if (blinkMeshes.length > 0) stepBlink(blink, v => applyBlinkMeshes(blinkMeshes, v), delta);

  controls.update();
  renderer.render(scene, camera);
}
animate();
</script>
</body>
</html>''';
}
