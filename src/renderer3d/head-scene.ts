import * as THREE from 'three';
import { log } from '../util/logger.js';
import * as fs from 'fs/promises';
import { HeadlessRenderer } from './headless-renderer.js';
import { VisemeId } from '../avatar/types.js';
import { MorphWeights, HeadConfig, FaceBounds } from '../head/types.js';
import { VISEME_MORPH_WEIGHTS, BLINK_MORPH } from '../head/viseme-to-morph.js';
import { IdleAnimator } from '../render/idle-animator.js';

export class HeadScene {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private headGroup: THREE.Object3D | null = null; // root of the loaded model — ALL meshes rotate together
  private headMesh: THREE.SkinnedMesh | THREE.Mesh | null = null;
  private morphTargetNames: string[] = [];
  private renderer: HeadlessRenderer;
  private idleAnimator: IdleAnimator;
  private currentViseme: VisemeId = 'rest';
  private blinkProgress = 0;
  private manualYaw = 0;   // radians, accumulated from mouse drag
  private manualPitch = 0;

  constructor(renderer: HeadlessRenderer) {
    this.renderer = renderer;
    this.idleAnimator = new IdleAnimator();

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x2a2a2a);

    // Camera: positioned to frame a head/shoulders portrait
    this.camera = new THREE.PerspectiveCamera(
      35,
      renderer.width / renderer.height,
      0.1,
      100,
    );
    this.camera.position.set(0, 0.25, 2.2);
    this.camera.lookAt(0, 0.1, 0);

    // Lighting: key + fill + rim for face rendering
    const keyLight = new THREE.DirectionalLight(0xfff5e0, 1.8);
    keyLight.position.set(1, 1.5, 2);
    this.scene.add(keyLight);

    const fillLight = new THREE.DirectionalLight(0xe0f0ff, 0.6);
    fillLight.position.set(-1.5, 0.5, 1.5);
    this.scene.add(fillLight);

    const rimLight = new THREE.DirectionalLight(0xffffff, 0.4);
    rimLight.position.set(0, 2, -2);
    this.scene.add(rimLight);

    const ambient = new THREE.AmbientLight(0xffffff, 0.3);
    this.scene.add(ambient);
  }

  async loadModel(config: HeadConfig): Promise<void> {
    const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');

    // Load glb file
    const fileData = await fs.readFile(config.modelPath);
    const arrayBuffer = fileData.buffer.slice(
      fileData.byteOffset,
      fileData.byteOffset + fileData.byteLength,
    ) as ArrayBuffer;

    const gltf = await new Promise<any>((resolve, reject) => {
      const loader = new GLTFLoader();
      // facecap.glb has KTX2-compressed embedded textures; we replace them with
      // the DALL-E texture anyway, so a dummy loader that returns a blank texture is fine.
      loader.setMeshoptDecoder(MeshoptDecoder);
      loader.setKTX2Loader({
        detectSupport: () => {},
        setTranscoderPath: () => {},
        init: () => Promise.resolve(),
        load: (_url: string, onLoad: (t: any) => void) => {
          onLoad(new THREE.DataTexture(new Uint8Array(4), 1, 1));
        },
      } as any);
      loader.parse(arrayBuffer, '', resolve, reject);
    });

    // Auto-scale and centre first so matrixWorld is correct when we project UVs
    this.headGroup = gltf.scene;
    const bbox = new THREE.Box3().setFromObject(gltf.scene);
    const bsize = bbox.getSize(new THREE.Vector3());
    const bcentre = bbox.getCenter(new THREE.Vector3());
    const scaleFactor = 1.5 / Math.max(bsize.x, bsize.y, bsize.z);
    gltf.scene.scale.setScalar(scaleFactor);
    gltf.scene.position.sub(bcentre.multiplyScalar(scaleFactor));

    this.scene.add(gltf.scene);

    // Propagate transforms so each mesh has an accurate matrixWorld
    gltf.scene.updateMatrixWorld(true);

    // Find the mesh with morph targets
    gltf.scene.traverse((node: THREE.Object3D) => {
      if (
        (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) &&
        node.morphTargetDictionary
      ) {
        this.headMesh = node;
        this.morphTargetNames = Object.keys(node.morphTargetDictionary);
      }
    });

    if (!this.headMesh) {
      log.warn('No mesh with morph targets found — viseme animation disabled');
    } else {
      const matType = Array.isArray(this.headMesh.material)
        ? this.headMesh.material.map((m: any) => m?.type).join(', ')
        : (this.headMesh.material as any)?.type;
      log.info(`Loaded model with ${this.morphTargetNames.length} morph targets (material: ${matType})`);
    }

    // Recompute normals and apply world-space cylindrical UV projection.
    // World space: Y=up, Z=forward (toward camera at z=2.2) — avoids any local-axis ambiguity.
    gltf.scene.traverse((node: THREE.Object3D) => {
      if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
        node.geometry.computeVertexNormals();
        applyWorldSpaceCylindricalUVs(node.geometry, node.matrixWorld, config.faceBounds);
      }
    });

    // Replace material
    if (config.texturePath) {
      const texture = await this.renderer.loadTexture(config.texturePath);
      texture.wrapS = THREE.ClampToEdgeWrapping;
      texture.wrapT = THREE.ClampToEdgeWrapping;
      this.renderer.threeRenderer.initTexture(texture);
      const faceMaterial = new THREE.MeshBasicMaterial({ map: texture });
      let meshCount = 0;
      gltf.scene.traverse((node: THREE.Object3D) => {
        if (node instanceof THREE.Mesh || node instanceof THREE.SkinnedMesh) {
          node.material = faceMaterial;
          meshCount++;
        }
      });
      log.info(`[Texture] Applied to ${meshCount} mesh(es)`);
    }
  }

  setViseme(visemeId: VisemeId): void {
    this.currentViseme = visemeId;
  }

  setBlinkProgress(progress: number): void {
    this.blinkProgress = progress;
  }

  renderFrame(): Buffer {
    const idle = this.idleAnimator.tick();
    this.blinkProgress = idle.blinkProgress;

    // Apply morph targets
    if (this.headMesh?.morphTargetDictionary && this.headMesh.morphTargetInfluences) {
      // Reset all to zero
      this.headMesh.morphTargetInfluences.fill(0);

      // Apply viseme weights
      const weights: MorphWeights = {
        ...VISEME_MORPH_WEIGHTS[this.currentViseme],
      };

      // Blend in blink
      if (this.blinkProgress > 0) {
        weights['eyeBlinkLeft'] = this.blinkProgress;
        weights['eyeBlinkRight'] = this.blinkProgress;
      }

      for (const [name, weight] of Object.entries(weights)) {
        const idx = this.headMesh.morphTargetDictionary[name];
        if (idx !== undefined) {
          this.headMesh.morphTargetInfluences[idx] = weight ?? 0;
        }
      }
    }

    // Rotate the whole group so all meshes (face, eyes, teeth) move together
    if (this.headGroup) {
      this.headGroup.rotation.y = this.manualYaw   + idle.dx * 0.004;
      this.headGroup.rotation.x = this.manualPitch + idle.dy * 0.003;
    }

    return this.renderer.render(this.scene, this.camera);
  }

  /** Accumulate mouse-drag rotation. dx/dy are pixel deltas from SDL mouseMove. */
  addRotation(dx: number, dy: number): void {
    this.manualYaw   += dx * 0.005;
    this.manualPitch += dy * 0.005;
    // Clamp pitch so the head doesn't flip upside-down
    this.manualPitch = Math.max(-Math.PI / 3, Math.min(Math.PI / 3, this.manualPitch));
  }

  resetIdle(): void {
    this.idleAnimator.reset();
  }
}

/**
 * Compute UVs by projecting vertices from the front (along +Z).
 * Only the forward-facing half of the geometry is used to determine the
 * face bounding box, so a portrait photo fills the face region correctly.
 * Back-of-head vertices are clamped to the texture edge.
 */
/**
 * Cylindrical UV projection using world-space vertex positions.
 * World space: Y=up, Z=toward camera (forward). Rotating around the Y axis.
 *
 * angle=0 (Z=max, directly toward camera) → U=face centre.
 * faceBounds anchors the face region in the portrait image precisely.
 */
function applyWorldSpaceCylindricalUVs(
  geometry: THREE.BufferGeometry,
  matrixWorld: THREE.Matrix4,
  faceBounds?: FaceBounds,
): void {
  // Rename so old code below still compiles
  return applyFrontFacePlanarUVs(geometry, matrixWorld, faceBounds);
}

function applyFrontFacePlanarUVs(geometry: THREE.BufferGeometry, matrixWorld: THREE.Matrix4, faceBounds?: FaceBounds): void {
  const pos = geometry.attributes['position'] as THREE.BufferAttribute;
  const tmp = new THREE.Vector3();

  // Transform all vertices to world space (Y=up, Z=toward camera)
  const wx: number[] = new Array(pos.count);
  const wy: number[] = new Array(pos.count);
  const wz: number[] = new Array(pos.count);
  for (let i = 0; i < pos.count; i++) {
    tmp.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(matrixWorld);
    wx[i] = tmp.x; wy[i] = tmp.y; wz[i] = tmp.z;
  }

  // Front-facing vertices = highest world Z (closest to camera at z=2.2)
  const wzSorted = [...wz].sort((a, b) => a - b);
  const zMid = wzSorted[Math.floor(wzSorted.length / 2)];

  // World Y range of front-facing vertices (for vertical mapping)
  let yMin = Infinity, yMax = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    if (wz[i] >= zMid) {
      yMin = Math.min(yMin, wy[i]);
      yMax = Math.max(yMax, wy[i]);
    }
  }
  const yRange = yMax - yMin || 1;

  // Half-FOV: ±this angle spans the face width in U (world X/Z plane, Y axis up)
  const halfFov = (90 * Math.PI) / 180;

  // Expand face bounds by uvScale so texture appears at correct size on model
  const uScale = 1.4;
  const vScale = 1; // vertical scaling can be separate if needed
  const uRot = 0.0; // model rotation in X/Z plane
  const vOffset = 0.1;
  const uCenter = ((faceBounds?.left ?? 0) + (faceBounds?.right  ?? 1)) / 2;
  const vCenter = ((faceBounds?.top  ?? 0) + (faceBounds?.bottom ?? 1)) / 2 + vOffset;
  const uHalf   = ((faceBounds?.right  ?? 1) - (faceBounds?.left ?? 0)) / 2 * uScale;
  const vHalf   = ((faceBounds?.bottom ?? 1) - (faceBounds?.top  ?? 0)) / 2 * vScale;
  const uLeft   = uCenter - uHalf;
  const uRight  = uCenter + uHalf;
  const vTop    = vCenter - vHalf;
  const vBottom = vCenter + vHalf;

  const uvs = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    // Horizontal: angle around world Y axis; Z=forward (angle=0) → face centre
    const angle = Math.atan2(wx[i], wz[i]) - uRot; // rotate model in X/Z plane if needed
    const angleNorm = angle / halfFov;
    uvs[i * 2] = uLeft + (angleNorm + 1) / 2 * (uRight - uLeft);

    // Vertical: world Y height; top of face → V=vTop, chin → V=vBottom.
    // Invert because DataTexture V=0 is image-bottom after flipRGBA.
    const yNorm = (wy[i] - yMin) / yRange; // 0=chin, 1=forehead
    uvs[i * 2 + 1] = 1.0 - (vBottom - yNorm * (vBottom - vTop));
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
}

