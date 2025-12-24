import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

// ===== CONFIGURATION =====
const CONFIG = {
    colors: {
        bg: 0x000000,
        champagneGold: 0xffd966,
        deepGreen: 0x03180a,
        accentRed: 0x990000,
    },
    particles: {
        count: 1500,
        dustCount: 2500,
        treeHeight: 24,
        treeRadius: 8
    },
    camera: {
        z: 50
    }
};

const STATE = {
    mode: 'TREE',
    focusIndex: -1,
    focusTarget: null
};

// ===== GLOBAL VARIABLES =====
let scene, camera, renderer, composer, controls;
let mainGroup;
let clock = new THREE.Clock();
let particleSystem = [];
let photoMeshGroup = new THREE.Group();
let caneTexture;
let raycaster, mouse;
let lastClickTime = 0;
let clickTimeout = null;
let imageQueue = [];
let currentImageIndex = 0;

// ===== INITIALIZATION =====
function init() {
    initThree();
    setupControls();
    setupEnvironment();
    setupLights();
    createTextures();
    createParticles();
    createDust();
    setupPostProcessing();
    setupEvents();

    const loader = document.getElementById('loader');
    loader.style.opacity = 0;
    setTimeout(() => {
        loader.remove();
        setupMusic();
    }, 800);

    animate();
}

// ===== THREE.JS SETUP =====
function initThree() {
    const container = document.getElementById('canvas-container');
    scene = new THREE.Scene();
    scene.background = new THREE.Color(CONFIG.colors.bg);
    scene.fog = new THREE.FogExp2(CONFIG.colors.bg, 0.01);

    camera = new THREE.PerspectiveCamera(42, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.set(0, 2, CONFIG.camera.z);

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ReinhardToneMapping;
    renderer.toneMappingExposure = 2.2;
    container.appendChild(renderer.domElement);

    mainGroup = new THREE.Group();
    scene.add(mainGroup);

    raycaster = new THREE.Raycaster();
    mouse = new THREE.Vector2();
}

function setupControls() {
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.minDistance = 20;
    controls.maxDistance = 100;
    controls.maxPolarAngle = Math.PI / 2.2;
    controls.minPolarAngle = Math.PI / 4;
    controls.enablePan = false;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.0;
    controls.target.set(0, 0, 0);
}

function setupEnvironment() {
    const pmremGenerator = new THREE.PMREMGenerator(renderer);
    scene.environment = pmremGenerator.fromScene(new RoomEnvironment(), 0.04).texture;
}

function setupLights() {
    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(ambient);

    const innerLight = new THREE.PointLight(0xffaa00, 2, 20);
    innerLight.position.set(0, 5, 0);
    mainGroup.add(innerLight);

    const spotGold = new THREE.SpotLight(0xffcc66, 1200);
    spotGold.position.set(30, 40, 40);
    spotGold.angle = 0.5;
    spotGold.penumbra = 0.5;
    scene.add(spotGold);

    const spotBlue = new THREE.SpotLight(0x6688ff, 600);
    spotBlue.position.set(-30, 20, -30);
    scene.add(spotBlue);

    const fill = new THREE.DirectionalLight(0xffeebb, 0.8);
    fill.position.set(0, 0, 50);
    scene.add(fill);
}

function setupPostProcessing() {
    const renderScene = new RenderPass(scene, camera);
    const bloomPass = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 1.5, 0.4, 0.85);
    bloomPass.threshold = 0.7;
    bloomPass.strength = 0.45;
    bloomPass.radius = 0.4;

    composer = new EffectComposer(renderer);
    composer.addPass(renderScene);
    composer.addPass(bloomPass);
}

// ===== TEXTURES & MATERIALS =====
function createTextures() {
    const canvas = document.createElement('canvas');
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, 128, 128);
    ctx.fillStyle = '#880000';
    ctx.beginPath();
    for (let i = -128; i < 256; i += 32) {
        ctx.moveTo(i, 0);
        ctx.lineTo(i + 32, 128);
        ctx.lineTo(i + 16, 128);
        ctx.lineTo(i - 16, 0);
    }
    ctx.fill();
    caneTexture = new THREE.CanvasTexture(canvas);
    caneTexture.wrapS = THREE.RepeatWrapping;
    caneTexture.wrapT = THREE.RepeatWrapping;
    caneTexture.repeat.set(3, 3);
}

// ===== PARTICLE SYSTEM =====
class Particle {
    constructor(mesh, type, isDust = false) {
        this.mesh = mesh;
        this.type = type;
        this.isDust = isDust;

        this.posTree = new THREE.Vector3();
        this.posScatter = new THREE.Vector3();
        this.baseScale = mesh.scale.x;

        // Photos spin slower to maintain readability
        const speedMult = (type === 'PHOTO') ? 0.3 : 2.0;

        this.spinSpeed = new THREE.Vector3(
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult,
            (Math.random() - 0.5) * speedMult
        );

        this.calculatePositions();
    }

    calculatePositions() {
        // TREE mode: Tight spiral formation
        const h = CONFIG.particles.treeHeight;
        const halfH = h / 2;
        let t = Math.random();
        t = Math.pow(t, 0.8);
        const y = (t * h) - halfH;
        let rMax = CONFIG.particles.treeRadius * (1.0 - t);
        if (rMax < 0.5) rMax = 0.5;
        const angle = t * 50 * Math.PI + Math.random() * Math.PI;
        const r = rMax * (0.8 + Math.random() * 0.4);
        this.posTree.set(Math.cos(angle) * r, y, Math.sin(angle) * r);

        // SCATTER mode: Random 3D sphere distribution
        let rScatter = this.isDust ? (12 + Math.random() * 20) : (8 + Math.random() * 12);
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        this.posScatter.set(
            rScatter * Math.sin(phi) * Math.cos(theta),
            rScatter * Math.sin(phi) * Math.sin(theta),
            rScatter * Math.cos(phi)
        );
    }

    update(dt, mode, focusTargetMesh) {
        let target = this.posTree;

        if (mode === 'SCATTER') {
            target = this.posScatter;
        } else if (mode === 'FOCUS') {
            if (this.mesh === focusTargetMesh) {
                // Transform world position to local space for focused photo
                const desiredWorldPos = new THREE.Vector3(0, 2, 35);
                const invMatrix = new THREE.Matrix4().copy(mainGroup.matrixWorld).invert();
                target = desiredWorldPos.applyMatrix4(invMatrix);
            } else {
                target = this.posScatter;
            }
        }

        // Faster movement for focused items
        const lerpSpeed = (mode === 'FOCUS' && this.mesh === focusTargetMesh) ? 5.0 : 2.0;
        this.mesh.position.lerp(target, lerpSpeed * dt);

        // Rotation behavior based on mode
        if (mode === 'SCATTER') {
            this.mesh.rotation.x += this.spinSpeed.x * dt;
            this.mesh.rotation.y += this.spinSpeed.y * dt;
            this.mesh.rotation.z += this.spinSpeed.z * dt;
        } else if (mode === 'TREE') {
            // Smoothly reset rotations in tree mode
            this.mesh.rotation.x = THREE.MathUtils.lerp(this.mesh.rotation.x, 0, dt);
            this.mesh.rotation.z = THREE.MathUtils.lerp(this.mesh.rotation.z, 0, dt);
            this.mesh.rotation.y += 0.5 * dt;
        }

        if (mode === 'FOCUS' && this.mesh === focusTargetMesh) {
            this.mesh.lookAt(camera.position);
        }

        // Scale logic based on mode and particle type
        let s = this.baseScale;
        if (this.isDust) {
            s = this.baseScale * (0.8 + 0.4 * Math.sin(clock.elapsedTime * 4 + this.mesh.id));
            if (mode === 'TREE') s = 0;
        } else if (mode === 'SCATTER' && this.type === 'PHOTO') {
            s = this.baseScale * 2.5;
        } else if (mode === 'FOCUS') {
            if (this.mesh === focusTargetMesh) s = 4.5;
            else s = this.baseScale * 0.8;
        }

        this.mesh.scale.lerp(new THREE.Vector3(s, s, s), 4 * dt);
    }
}

function createParticles() {
    const sphereGeo = new THREE.SphereGeometry(0.5, 32, 32);
    const boxGeo = new THREE.BoxGeometry(0.55, 0.55, 0.55);
    const curve = new THREE.CatmullRomCurve3([
        new THREE.Vector3(0, -0.5, 0),
        new THREE.Vector3(0, 0.3, 0),
        new THREE.Vector3(0.1, 0.5, 0),
        new THREE.Vector3(0.3, 0.4, 0)
    ]);
    const candyGeo = new THREE.TubeGeometry(curve, 16, 0.08, 8, false);

    const goldMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.champagneGold,
        metalness: 1.0,
        roughness: 0.1,
        envMapIntensity: 2.0,
        emissive: 0x443300,
        emissiveIntensity: 0.3
    });

    const greenMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.deepGreen,
        metalness: 0.2,
        roughness: 0.8,
        emissive: 0x002200,
        emissiveIntensity: 0.2
    });

    const redMat = new THREE.MeshPhysicalMaterial({
        color: CONFIG.colors.accentRed,
        metalness: 0.3,
        roughness: 0.2,
        clearcoat: 1.0,
        emissive: 0x330000
    });

    const candyMat = new THREE.MeshStandardMaterial({ map: caneTexture, roughness: 0.4 });

    for (let i = 0; i < CONFIG.particles.count; i++) {
        const rand = Math.random();
        let mesh, type;

        if (rand < 0.40) {
            mesh = new THREE.Mesh(boxGeo, greenMat);
            type = 'BOX';
        } else if (rand < 0.70) {
            mesh = new THREE.Mesh(boxGeo, goldMat);
            type = 'GOLD_BOX';
        } else if (rand < 0.92) {
            mesh = new THREE.Mesh(sphereGeo, goldMat);
            type = 'GOLD_SPHERE';
        } else if (rand < 0.97) {
            mesh = new THREE.Mesh(sphereGeo, redMat);
            type = 'RED';
        } else {
            mesh = new THREE.Mesh(candyGeo, candyMat);
            type = 'CANE';
        }

        const s = 0.4 + Math.random() * 0.5;
        mesh.scale.set(s, s, s);
        mesh.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);

        mainGroup.add(mesh);
        particleSystem.push(new Particle(mesh, type, false));
    }

    // Add tree topper star
    const starGeo = new THREE.OctahedronGeometry(1.2, 0);
    const starMat = new THREE.MeshStandardMaterial({
        color: 0xffdd88,
        emissive: 0xffaa00,
        emissiveIntensity: 1.0,
        metalness: 1.0,
        roughness: 0
    });
    const star = new THREE.Mesh(starGeo, starMat);
    star.position.set(0, CONFIG.particles.treeHeight / 2 + 1.2, 0);
    mainGroup.add(star);

    mainGroup.add(photoMeshGroup);
}

function createDust() {
    const geo = new THREE.TetrahedronGeometry(0.08, 0);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffeebb, transparent: true, opacity: 0.8 });

    for (let i = 0; i < CONFIG.particles.dustCount; i++) {
        const mesh = new THREE.Mesh(geo, mat);
        mesh.scale.setScalar(0.5 + Math.random());
        mainGroup.add(mesh);
        particleSystem.push(new Particle(mesh, 'DUST', true));
    }
}

// ===== PHOTO MANAGEMENT =====
function addPhotoToScene(texture, quote = '') {
    const frameGeo = new THREE.BoxGeometry(1.4, 1.4, 0.05);
    const frameMat = new THREE.MeshStandardMaterial({
        color: CONFIG.colors.champagneGold,
        metalness: 1.0,
        roughness: 0.1
    });
    const frame = new THREE.Mesh(frameGeo, frameMat);

    const photoGeo = new THREE.PlaneGeometry(1.2, 1.2);
    const photoMat = new THREE.MeshBasicMaterial({ map: texture });
    const photo = new THREE.Mesh(photoGeo, photoMat);
    photo.position.z = 0.04;

    const group = new THREE.Group();
    group.add(frame);
    group.add(photo);
    group.userData.quote = quote || '';

    const s = 0.8;
    group.scale.set(s, s, s);

    photoMeshGroup.add(group);
    particleSystem.push(new Particle(group, 'PHOTO', false));
}

function handleImageUpload(e) {
    const files = e.target.files;
    if (!files.length) return;

    const uploadUI = document.querySelector('.upload-wrapper');
    uploadUI.classList.add('ui-hidden');

    const greeting = document.getElementById('greeting');
    greeting.classList.remove('ui-hidden');

    imageQueue = [];
    currentImageIndex = 0;

    Array.from(files).forEach(f => {
        const reader = new FileReader();
        reader.onload = (ev) => {
            imageQueue.push(ev.target.result);
            if (imageQueue.length === files.length) {
                processNextImage();
            }
        };
        reader.readAsDataURL(f);
    });
}

function processNextImage() {
    if (currentImageIndex >= imageQueue.length) {
        document.getElementById('file-input').value = '';
        return;
    }

    const imageData = imageQueue[currentImageIndex];
    const modal = document.getElementById('quote-modal');
    const quoteInput = document.getElementById('quote-input');
    quoteInput.value = '';
    modal.classList.add('show');
    quoteInput.focus();
    quoteInput.dataset.imageData = imageData;
}

function addPhotoWithQuote(imageData, quote) {
    new THREE.TextureLoader().load(imageData, (t) => {
        t.colorSpace = THREE.SRGBColorSpace;
        addPhotoToScene(t, quote);
        currentImageIndex++;
        processNextImage();
    });
}

// ===== EVENT HANDLERS =====
function setupEvents() {
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
        composer.setSize(window.innerWidth, window.innerHeight);
        controls.update();
    });

    document.getElementById('file-input').addEventListener('change', handleImageUpload);

    document.querySelectorAll('.mode-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const mode = btn.dataset.mode;
            setMode(mode);
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
        });
    });

    renderer.domElement.addEventListener('click', onCanvasClick);
    renderer.domElement.addEventListener('dblclick', onCanvasDoubleClick);

    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'h') {
            const uploadWrapper = document.querySelector('.upload-wrapper');
            const modeControls = document.getElementById('mode-controls');
            const controlsHint = document.querySelector('.controls-hint');
            const musicControlWrapper = document.getElementById('music-control-wrapper');

            if (uploadWrapper) uploadWrapper.classList.toggle('ui-hidden');
            if (modeControls) modeControls.classList.toggle('ui-hidden');
            if (controlsHint) controlsHint.classList.toggle('ui-hidden');
            if (musicControlWrapper) musicControlWrapper.classList.toggle('ui-hidden');
        }
    });

    // Quote modal handlers
    document.getElementById('quote-submit').addEventListener('click', () => {
        const quoteInput = document.getElementById('quote-input');
        const quote = quoteInput.value.trim();
        const imageData = quoteInput.dataset.imageData;
        document.getElementById('quote-modal').classList.remove('show');
        addPhotoWithQuote(imageData, quote);
    });

    document.getElementById('quote-skip').addEventListener('click', () => {
        const quoteInput = document.getElementById('quote-input');
        const imageData = quoteInput.dataset.imageData;
        document.getElementById('quote-modal').classList.remove('show');
        addPhotoWithQuote(imageData, '');
    });

    const quoteDisplay = document.getElementById('quote-display');
    document.getElementById('quote-close').addEventListener('click', () => {
        quoteDisplay.classList.remove('show');
    });

    quoteDisplay.addEventListener('click', (e) => {
        if (e.target === quoteDisplay) {
            quoteDisplay.classList.remove('show');
        }
    });

    document.getElementById('quote-modal').addEventListener('click', (e) => {
        if (e.target.id === 'quote-modal') {
            const quoteInput = document.getElementById('quote-input');
            const imageData = quoteInput.dataset.imageData;
            document.getElementById('quote-modal').classList.remove('show');
            addPhotoWithQuote(imageData, '');
        }
    });

    document.getElementById('quote-input').addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            document.getElementById('quote-submit').click();
        }
    });

    // Music control handlers
    const musicControl = document.getElementById('music-control');
    const bgm = document.getElementById('bgm');
    const progressBar = document.getElementById('music-progress-bar');
    const progressFill = document.getElementById('music-progress-fill');
    const progressHandle = document.getElementById('music-progress-handle');
    const currentTimeEl = document.getElementById('music-current-time');
    const durationEl = document.getElementById('music-duration');

    musicControl.addEventListener('click', () => {
        if (bgm.paused) {
            bgm.play().catch(err => {
                console.log('Auto-play prevented:', err);
            });
            musicControl.classList.add('playing');
        } else {
            bgm.pause();
            musicControl.classList.remove('playing');
        }
    });

    let isDragging = false;

    progressBar.addEventListener('click', (e) => {
        if (!isDragging) {
            const rect = progressBar.getBoundingClientRect();
            const percent = (e.clientX - rect.left) / rect.width;
            bgm.currentTime = percent * bgm.duration;
        }
    });

    progressBar.addEventListener('mousedown', (e) => {
        isDragging = true;
        const rect = progressBar.getBoundingClientRect();
        const percent = (e.clientX - rect.left) / rect.width;
        bgm.currentTime = percent * bgm.duration;
    });

    document.addEventListener('mousemove', (e) => {
        if (isDragging) {
            const rect = progressBar.getBoundingClientRect();
            const percent = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
            bgm.currentTime = percent * bgm.duration;
        }
    });

    document.addEventListener('mouseup', () => {
        isDragging = false;
    });

    function updateProgress() {
        if (bgm.duration) {
            const percent = (bgm.currentTime / bgm.duration) * 100;
            progressFill.style.width = percent + '%';
            progressHandle.style.left = percent + '%';
            currentTimeEl.textContent = formatTime(bgm.currentTime);
            durationEl.textContent = formatTime(bgm.duration);
        }
    }

    function formatTime(seconds) {
        if (isNaN(seconds)) return '0:00';
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        return `${mins}:${secs.toString().padStart(2, '0')}`;
    }

    setInterval(updateProgress, 100);

    bgm.addEventListener('loadedmetadata', () => {
        durationEl.textContent = formatTime(bgm.duration);
    });
}

function setupMusic() {
    const bgm = document.getElementById('bgm');
    const musicControl = document.getElementById('music-control');

    bgm.volume = 0.5;

    bgm.play().then(() => {
        musicControl.classList.add('playing');
    }).catch(err => {
        console.log('Autoplay prevented. User must click play button.');
        musicControl.classList.remove('playing');
    });

    bgm.addEventListener('play', () => {
        musicControl.classList.add('playing');
    });

    bgm.addEventListener('pause', () => {
        musicControl.classList.remove('playing');
    });
}

// ===== MODE MANAGEMENT =====
function setMode(mode) {
    STATE.mode = mode;
    STATE.focusTarget = null;

    if (mode === 'FOCUS') {
        const photos = particleSystem.filter(p => p.type === 'PHOTO');
        if (photos.length) {
            STATE.focusTarget = photos[Math.floor(Math.random() * photos.length)].mesh;
        } else {
            STATE.mode = 'TREE';
        }
    }

    if (mode === 'TREE') {
        controls.autoRotate = true;
        controls.autoRotateSpeed = 1.0;
    } else {
        controls.autoRotate = false;
    }
}

function showQuote(quote) {
    const quoteDisplay = document.getElementById('quote-display');
    const quoteText = document.getElementById('quote-text');

    if (quoteDisplay.timeoutId) {
        clearTimeout(quoteDisplay.timeoutId);
    }

    quoteDisplay.style.top = '50%';
    quoteDisplay.style.left = '50%';
    quoteDisplay.style.transform = 'translate(-50%, -50%) scale(0.92)';
    quoteText.textContent = quote;

    // Force reflow to ensure transform is applied before adding show class
    quoteDisplay.offsetHeight;

    quoteDisplay.classList.add('show');

    quoteDisplay.timeoutId = setTimeout(() => {
        quoteDisplay.classList.remove('show');
        quoteDisplay.timeoutId = null;
    }, 5000);
}

function onCanvasClick(event) {
    mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
    mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const photoIntersects = raycaster.intersectObjects(photoMeshGroup.children, true);

    if (photoIntersects.length > 0) {
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
        }

        const clickedPhoto = photoIntersects[0].object.parent;
        const quote = clickedPhoto.userData.quote || '';

        // In SCATTER mode, clicking photo with quote shows the quote
        if (STATE.mode === 'SCATTER' && quote) {
            showQuote(quote);
            return;
        }

        // Otherwise, focus on the clicked photo
        STATE.mode = 'FOCUS';
        STATE.focusTarget = clickedPhoto;
        document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
        const focusBtn = document.querySelector('[data-mode="FOCUS"]');
        if (focusBtn) focusBtn.classList.add('active');
        controls.autoRotate = false;
        return;
    }

    // Delay single click detection to allow double-click to fire first
    const now = Date.now();
    const timeSinceLastClick = now - lastClickTime;

    if (timeSinceLastClick < 300 && timeSinceLastClick > 0) {
        if (clickTimeout) {
            clearTimeout(clickTimeout);
            clickTimeout = null;
        }
    } else {
        if (clickTimeout) {
            clearTimeout(clickTimeout);
        }
        clickTimeout = setTimeout(() => {
            clickTimeout = null;
        }, 300);
    }

    lastClickTime = now;
}

function onCanvasDoubleClick(event) {
    if (clickTimeout) {
        clearTimeout(clickTimeout);
        clickTimeout = null;
    }

    // SCATTER mode: double-click anywhere → switch to FOCUS
    if (STATE.mode === 'SCATTER') {
        const photos = particleSystem.filter(p => p.type === 'PHOTO');
        if (photos.length) {
            setMode('FOCUS');
            STATE.focusTarget = photos[Math.floor(Math.random() * photos.length)].mesh;
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            const focusBtn = document.querySelector('[data-mode="FOCUS"]');
            if (focusBtn) focusBtn.classList.add('active');
            controls.autoRotate = false;
        }
        return;
    }

    // TREE mode: double-click tree → switch to SCATTER
    if (STATE.mode === 'TREE') {
        mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
        mouse.y = -(event.clientY / window.innerHeight) * 2 + 1;

        raycaster.setFromCamera(mouse, camera);

        const allObjects = [];
        mainGroup.traverse((child) => {
            if (child !== photoMeshGroup && child !== mainGroup && child.isMesh) {
                allObjects.push(child);
            }
        });

        const treeIntersects = raycaster.intersectObjects(allObjects, true);

        if (treeIntersects.length > 0) {
            setMode('SCATTER');
            document.querySelectorAll('.mode-btn').forEach(b => b.classList.remove('active'));
            const scatterBtn = document.querySelector('[data-mode="SCATTER"]');
            if (scatterBtn) scatterBtn.classList.add('active');
            controls.autoRotate = false;
        }
    }
}

// ===== ANIMATION LOOP =====
function animate() {
    requestAnimationFrame(animate);
    const dt = clock.getDelta();

    controls.update();
    particleSystem.forEach(p => p.update(dt, STATE.mode, STATE.focusTarget));
    composer.render();
}

init();
