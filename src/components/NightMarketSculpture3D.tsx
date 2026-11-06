import React, { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// Pre-allocated math objects outside the animation loop (Zero GC in render loop)
const _targetRot = new THREE.Vector2(0, 0);
const _currentRot = new THREE.Vector2(0, 0);

/**
 * Decorative Three.js sculptural hero accent with lively kinetic gyroscope motion:
 * - Interlocking composite sculpture (3 primary sculptural torus-ribbon rings in
 *   Champagne Gold, Rose Pink Metallic, and Translucent Teal, 3 inner chamfered metallic
 *   bezels, 1 central core ring, 1 multifaceted rose-gold crystal core, 8 orbiting luminous pearls,
 *   and 1 grounded radial contact shadow plane).
 * - Uses RoomEnvironment + PMREMGenerator, ACESFilmicToneMapping, warm key light + rose/teal rim lights.
 * - Detects software WebGL (isSoftwareGl) and paces rendering via afterDraw(tick).
 * - Pauses rendering when off-screen via IntersectionObserver and respects prefers-reduced-motion.
 */
export const NightMarketSculpture3D: React.FC = () => {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [webglFallback, setWebglFallback] = useState(false);

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const prefersReducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    let renderer: THREE.WebGLRenderer;
    let isSoftwareGl = false;

    try {
      const probeCanvas = document.createElement('canvas');
      const gl = probeCanvas.getContext('webgl2');
      if (!gl) {
        setWebglFallback(true);
        return;
      }
      const ext = gl.getExtension('WEBGL_debug_renderer_info');
      const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
      const gpu = String(gl.getParameter(param));
      gl.getExtension('WEBGL_lose_context')?.loseContext();
      isSoftwareGl = /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);

      renderer = new THREE.WebGLRenderer({
        antialias: !isSoftwareGl,
        alpha: true,
        powerPreference: 'high-performance',
      });
    } catch {
      setWebglFallback(true);
      return;
    }

    const width = container.clientWidth || 380;
    const height = container.clientHeight || 300;

    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.22;
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.innerHTML = '';
    container.appendChild(renderer.domElement);

    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
    camera.position.set(0, 0.25, 6.2);
    camera.lookAt(0, 0, 0);

    // Studio PBR environment reflection via RoomEnvironment + PMREMGenerator
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
    pmremGenerator.dispose();

    // Warm key light + Rose Pink & Teal rim lights
    const hemiLight = new THREE.HemisphereLight(0xffd6e8, 0x4a0c2b, 1.1);
    scene.add(hemiLight);

    const keyLight = new THREE.DirectionalLight(0xffe6bd, 2.6);
    keyLight.position.set(4, 5, 4);
    if (!isSoftwareGl) {
      keyLight.castShadow = true;
      keyLight.shadow.mapSize.set(1024, 1024);
      keyLight.shadow.camera.near = 0.5;
      keyLight.shadow.camera.far = 15;
      const d = 3.5;
      keyLight.shadow.camera.left = -d;
      keyLight.shadow.camera.right = d;
      keyLight.shadow.camera.top = d;
      keyLight.shadow.camera.bottom = -d;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const tealRimLight = new THREE.PointLight(0x2dd4bf, 3.8, 12);
    tealRimLight.position.set(-3.2, -1.8, 2.5);
    scene.add(tealRimLight);

    const pinkRimLight = new THREE.PointLight(0xf472b6, 4.2, 12);
    pinkRimLight.position.set(3.2, -1.2, 2.8);
    scene.add(pinkRimLight);

    // Procedural brushed metal bump texture via HTML5 2D Canvas
    const bumpCanvas = document.createElement('canvas');
    bumpCanvas.width = 128;
    bumpCanvas.height = 128;
    const bCtx = bumpCanvas.getContext('2d');
    if (bCtx) {
      bCtx.fillStyle = '#808080';
      bCtx.fillRect(0, 0, 128, 128);
      for (let y = 0; y < 128; y += 2) {
        const shade = 115 + ((y * 7) % 25);
        bCtx.fillStyle = `rgb(${shade},${shade},${shade})`;
        bCtx.fillRect(0, y, 128, 1);
      }
    }
    const brushedBumpMap = new THREE.CanvasTexture(bumpCanvas);
    brushedBumpMap.wrapS = THREE.RepeatWrapping;
    brushedBumpMap.wrapT = THREE.RepeatWrapping;
    brushedBumpMap.repeat.set(4, 4);

    // Composite Lively Kinetic Hero Sculpture Group
    const sculptureGroup = new THREE.Group();
    sculptureGroup.position.set(0, 0.05, 0);
    scene.add(sculptureGroup);

    const primaryRingGeo = new THREE.TorusGeometry(1.25, 0.22, 28, 72);
    const innerBezelGeo = new THREE.TorusGeometry(1.0, 0.045, 16, 64);
    const coreRingGeo = new THREE.TorusGeometry(0.56, 0.045, 16, 48);
    const crystalCoreGeo = new THREE.OctahedronGeometry(0.32, 0);
    const pearlGeo = new THREE.SphereGeometry(0.08, 16, 16);

    // Material 1: Champagne Gold brushed alloy
    const champagneMat = new THREE.MeshPhysicalMaterial({
      color: 0xe6cb9f,
      metalness: 0.92,
      roughness: 0.16,
      bumpMap: brushedBumpMap,
      bumpScale: 0.004,
      clearcoat: 0.4,
    });

    // Material 2: Translucent Night-Market Teal Crystal
    const tealCrystalMat = new THREE.MeshPhysicalMaterial({
      color: 0x14b8a6,
      emissive: 0x083a35,
      emissiveIntensity: 0.42,
      metalness: 0.35,
      roughness: 0.12,
      transmission: isSoftwareGl ? 0 : 0.72,
      transparent: true,
      opacity: isSoftwareGl ? 0.9 : 1.0,
      ior: 1.6,
      thickness: 1.2,
      clearcoat: 0.9,
    });

    // Material 3: Warm Champagne-Bronze Metallic
    const rosePinkMat = new THREE.MeshPhysicalMaterial({
      color: 0xc8925a,
      emissive: 0x3d2310,
      emissiveIntensity: 0.22,
      metalness: 0.85,
      roughness: 0.2,
      bumpMap: brushedBumpMap,
      bumpScale: 0.005,
      clearcoat: 0.65,
    });

    // Material 4: Deep Espresso Slate Bezel
    const bezelMat = new THREE.MeshStandardMaterial({
      color: 0x292524,
      metalness: 0.65,
      roughness: 0.45,
    });

    // Part 1 & 2: Champagne Gold Primary Ring + Inner Bezel
    const ringChampagne = new THREE.Mesh(primaryRingGeo, champagneMat);
    ringChampagne.rotation.set(0.55, 0.65, 0.2);
    ringChampagne.castShadow = !isSoftwareGl;
    ringChampagne.receiveShadow = !isSoftwareGl;
    const bezel1 = new THREE.Mesh(innerBezelGeo, bezelMat);
    ringChampagne.add(bezel1);
    sculptureGroup.add(ringChampagne);

    // Part 3 & 4: Teal Crystal Secondary Interlocking Ring + Champagne Inner Bezel
    const ringTeal = new THREE.Mesh(primaryRingGeo, tealCrystalMat);
    ringTeal.rotation.set(-0.65, 0.4, -0.5);
    ringTeal.position.set(0.16, -0.12, 0.12);
    const bezel2 = new THREE.Mesh(innerBezelGeo, champagneMat);
    ringTeal.add(bezel2);
    sculptureGroup.add(ringTeal);

    // Part 5 & 6: Rose Pink Metallic Third Interlocking Ring + Inner Bezel
    const ringRose = new THREE.Mesh(primaryRingGeo, rosePinkMat);
    ringRose.rotation.set(1.2, -0.5, 0.75);
    ringRose.position.set(-0.14, 0.08, -0.14);
    const bezel3 = new THREE.Mesh(innerBezelGeo, champagneMat);
    ringRose.add(bezel3);
    sculptureGroup.add(ringRose);

    // Part 7: Inner orbital equilibrium ring
    const coreRing = new THREE.Mesh(coreRingGeo, champagneMat);
    coreRing.rotation.set(Math.PI / 3, Math.PI / 6, 0);
    sculptureGroup.add(coreRing);

    // Part 8: Central Faceted Rose-Gold Crystal Core
    const crystalCore = new THREE.Mesh(crystalCoreGeo, rosePinkMat);
    sculptureGroup.add(crystalCore);

    // Part 9: 8 Orbiting Luminous Pearls
    const orbitGroup = new THREE.Group();
    sculptureGroup.add(orbitGroup);
    const pearls: Array<{
      mesh: THREE.Mesh;
      radius: number;
      speed: number;
      phase: number;
      tiltX: number;
      tiltZ: number;
    }> = [];

    const pearlMats = [champagneMat, rosePinkMat, tealCrystalMat];
    for (let i = 0; i < 8; i++) {
      const pMesh = new THREE.Mesh(pearlGeo, pearlMats[i % pearlMats.length]);
      orbitGroup.add(pMesh);
      pearls.push({
        mesh: pMesh,
        radius: 1.55 + (i % 3) * 0.16,
        speed: (i % 2 === 0 ? 1 : -1) * (0.65 + (i % 3) * 0.22),
        phase: (i * Math.PI * 2) / 8,
        tiltX: ((i % 4) - 1.5) * 0.45,
        tiltZ: ((i % 3) - 1) * 0.5,
      });
    }

    // Part 10: Soft radial contact shadow plane grounded beneath the sculpture
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d');
    if (sCtx) {
      const grad = sCtx.createRadialGradient(64, 64, 8, 64, 64, 60);
      grad.addColorStop(0, 'rgba(55, 5, 30, 0.65)');
      grad.addColorStop(1, 'rgba(55, 5, 30, 0)');
      sCtx.fillStyle = grad;
      sCtx.fillRect(0, 0, 128, 128);
    }
    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const contactShadowGeo = new THREE.PlaneGeometry(3.8, 3.8);
    const contactShadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.55,
    });
    const contactShadow = new THREE.Mesh(contactShadowGeo, contactShadowMat);
    contactShadow.rotation.x = -Math.PI / 2;
    contactShadow.position.y = -1.78;
    scene.add(contactShadow);

    if (!isSoftwareGl) {
      renderer.compile(scene, camera);
    }

    let frameId = 0;
    let isVisible = true;
    let disposed = false;
    const startTimeMs = performance.now();
    let lastTimeMs = startTimeMs;

    function afterDraw(cb: () => void) {
      const gl = renderer.getContext() as WebGL2RenderingContext;
      const sync = gl.fenceSync ? gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0) : null;
      gl.flush();
      if (!sync) {
        frameId = window.setTimeout(cb, 65);
        return;
      }
      const poll = () => {
        if (disposed) return;
        const state = gl.getSyncParameter(sync, gl.SYNC_STATUS);
        if (state === gl.UNSIGNALED) {
          frameId = window.setTimeout(poll, 5);
        } else {
          gl.deleteSync(sync);
          frameId = window.setTimeout(cb, 65);
        }
      };
      frameId = window.setTimeout(poll, 5);
    }

    function tick() {
      if (disposed || !isVisible) return;
      const nowMs = performance.now();
      const dt = Math.min((nowMs - lastTimeMs) / 1000, 0.1);
      lastTimeMs = nowMs;
      const elapsed = (nowMs - startTimeMs) / 1000;

      if (!prefersReducedMotion) {
        const dampFactor = 1 - Math.exp(-5.5 * dt);
        _currentRot.x += (_targetRot.x - _currentRot.x) * dampFactor;
        _currentRot.y += (_targetRot.y - _currentRot.y) * dampFactor;

        // Lively vertical levitation + overall gyroscope rotation
        const bob = Math.sin(elapsed * 2.1) * 0.14;
        sculptureGroup.position.y = 0.05 + bob;
        sculptureGroup.rotation.y = elapsed * 0.42 + _currentRot.x * 0.55;
        sculptureGroup.rotation.x = Math.sin(elapsed * 0.85) * 0.16 + _currentRot.y * 0.4;

        // Multi-axis counter-rotation on individual rings
        ringChampagne.rotation.z = 0.2 + elapsed * 0.35;
        ringTeal.rotation.x = -0.65 + Math.sin(elapsed * 1.1) * 0.28;
        ringTeal.rotation.y = 0.4 - elapsed * 0.28;
        ringRose.rotation.y = -0.5 + elapsed * 0.32;
        ringRose.rotation.z = 0.75 + Math.cos(elapsed * 0.95) * 0.24;

        // Spinning & pulsing central crystal core
        coreRing.rotation.z = -elapsed * 0.85;
        coreRing.rotation.x = Math.PI / 3 + Math.sin(elapsed * 1.4) * 0.3;
        crystalCore.rotation.y = -elapsed * 1.25;
        crystalCore.rotation.x = elapsed * 0.9;
        const pulseScale = 1 + Math.sin(elapsed * 3.2) * 0.1;
        crystalCore.scale.setScalar(pulseScale);

        // Update 8 orbiting pearls
        for (let i = 0; i < pearls.length; i++) {
          const p = pearls[i];
          const angle = p.phase + elapsed * p.speed;
          const x = Math.cos(angle) * p.radius;
          const z = Math.sin(angle) * p.radius;
          const y = Math.sin(angle * 2 + p.tiltX) * 0.55;
          p.mesh.position.set(x, y, z);
        }

        // Dynamic contact shadow breathing
        const shadowScale = 1 - bob * 0.45;
        contactShadow.scale.set(shadowScale, shadowScale, 1);
      }

      renderer.render(scene, camera);

      if (prefersReducedMotion) return;
      if (isSoftwareGl) {
        afterDraw(tick);
      } else {
        frameId = requestAnimationFrame(tick);
      }
    }

    // Responsive pointer interaction
    const onPointerMove = (e: PointerEvent) => {
      if (prefersReducedMotion) return;
      const rect = container.getBoundingClientRect();
      const nx = ((e.clientX - rect.left) / Math.max(rect.width, 1)) * 2 - 1;
      const ny = ((e.clientY - rect.top) / Math.max(rect.height, 1)) * 2 - 1;
      _targetRot.set(nx, ny);
    };

    const onResize = () => {
      if (!container || disposed) return;
      const w = container.clientWidth || 380;
      const h = container.clientHeight || 300;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      renderer.render(scene, camera);
    };

    // Pause rendering when hero is scrolled out of view
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        const nextVisible = Boolean(entry?.isIntersecting);
        if (nextVisible && !isVisible) {
          isVisible = true;
          lastTimeMs = performance.now();
          tick();
        } else if (!nextVisible) {
          isVisible = false;
        }
      },
      { threshold: 0.05 }
    );
    observer.observe(container);

    container.addEventListener('pointermove', onPointerMove, { passive: true });
    window.addEventListener('resize', onResize);

    // Draw initial frame
    tick();

    return () => {
      disposed = true;
      cancelAnimationFrame(frameId);
      clearTimeout(frameId);
      observer.disconnect();
      container.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('resize', onResize);

      primaryRingGeo.dispose();
      innerBezelGeo.dispose();
      coreRingGeo.dispose();
      crystalCoreGeo.dispose();
      pearlGeo.dispose();
      contactShadowGeo.dispose();
      brushedBumpMap.dispose();
      shadowTex.dispose();
      champagneMat.dispose();
      tealCrystalMat.dispose();
      rosePinkMat.dispose();
      bezelMat.dispose();
      contactShadowMat.dispose();
      renderer.dispose();
    };
  }, []);

  if (webglFallback) {
    return (
      <div
        className="relative w-full h-64 md:h-80 flex items-center justify-center"
        aria-label="Night Market geometric emblem"
      >
        <div className="w-48 h-48 rounded-full border-8 border-[#DFC496]/60 shadow-inner flex items-center justify-center animate-float-orb">
          <div className="w-36 h-36 rounded-full border-8 border-[#F472B6]/80 rotate-45 flex items-center justify-center">
            <div className="w-24 h-24 rounded-full border-8 border-[#14B8A6]/80" />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      ref={mountRef}
      data-testid="hero-3d-sculpture"
      className="relative w-full h-64 md:h-80 select-none cursor-grab active:cursor-grabbing"
      aria-hidden="true"
    />
  );
};

export default NightMarketSculpture3D;
