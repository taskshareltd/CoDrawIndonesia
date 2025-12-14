import { initializeApp } from "https://www.gstatic.com/firebasejs/10.11.1/firebase-app.js";
import {
  getDatabase, ref, push, onChildAdded,
  onValue, remove, set, onDisconnect
} from "https://www.gstatic.com/firebasejs/10.11.1/firebase-database.js";

/* ================= FIREBASE ================= */
const app = initializeApp({
  apiKey: "AIzaSyCVxHjiJYYHVDO83WKak2fLetngGijHXyQ",
  databaseURL: "https://codraw-e9f48-default-rtdb.asia-southeast1.firebasedatabase.app",
});
const db = getDatabase(app);
const ROOM = "global";

/* ================= USER ================= */
const uid = localStorage.uid || (localStorage.uid = 'user_' + Math.random().toString(36).slice(2, 10));
const userName = `user${Math.floor(Math.random() * 9000 + 1000)}`;

const userRef = ref(db, `rooms/${ROOM}/users/${uid}`);
set(userRef, { name: userName, online: true });
onDisconnect(userRef).remove();

/* ================= CANVAS ================= */
const canvas = document.getElementById("canvas");
const ctx = canvas.getContext("2d");

/* ================= STATE ================= */
let strokes = {};
let currentStroke = null;
let isDrawing = false;
let drawMode = true;

let camera = { x: 0, y: 0, scale: 1 };

let activeTouches = new Map();
let isPanning = false;
let isPinching = false;
let lastPan = null;
let lastPinchDist = 0;

let currentTool = "pen";
let currentColor = "#2196F3";
let currentSize = 6;

/* ================= DOM ================= */
const controls = document.getElementById("controls");
const controlsFab = document.getElementById("controls-fab");

const drawModeBtn = document.getElementById("draw-mode-btn");
const modeLabel = document.getElementById("mode-label");
const drawIndicator = document.getElementById("draw-indicator");
const panIndicator = document.getElementById("pan-indicator");

const penBtn = document.getElementById("pen-btn");
const eraserBtn = document.getElementById("eraser-btn");
const colorPicker = document.getElementById("color-picker");
const colorDot = document.getElementById("current-color-dot");
const sizeBtns = document.querySelectorAll(".size-btn");
const resetViewBtn = document.getElementById("reset-view-btn");

const onlineCountEl = document.getElementById("online-count");
const zoomPercentEl = document.getElementById("zoom-percent");

/* Chat */
const chatPanel = document.getElementById("chat-panel");
const chatToggle = document.getElementById("chat-toggle");
const chatCountEl = document.getElementById("chat-count");
const messagesEl = document.getElementById("messages");
const messageInput = document.getElementById("message-input");
const sendBtn = document.getElementById("send-btn");

let messageCount = 0;

/* ================= INIT ================= */
function init() {
  resizeCanvas();
  setupEvents();
  setupFirebase();
  updateUI();
  requestAnimationFrame(render);
}
init();

/* ================= UTIL ================= */
function resizeCanvas() {
  const dpr = devicePixelRatio || 1;
  canvas.width = innerWidth * dpr;
  canvas.height = innerHeight * dpr;
  canvas.style.width = innerWidth + "px";
  canvas.style.height = innerHeight + "px";
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function screenToWorld(x, y) {
  return { x: x / camera.scale + camera.x, y: y / camera.scale + camera.y };
}

function worldToScreen(x, y) {
  return { x: (x - camera.x) * camera.scale, y: (y - camera.y) * camera.scale };
}

/* ================= EVENTS ================= */
function setupEvents() {
  window.addEventListener("resize", resizeCanvas);

  controlsFab.onclick = () => controls.classList.toggle("open");

  drawModeBtn.onclick = () => {
    drawMode = !drawMode;
    updateUI();
  };

  penBtn.onclick = () => setTool("pen");
  eraserBtn.onclick = () => setTool("eraser");

  colorPicker.oninput = e => {
    currentColor = e.target.value;
    colorDot.style.background = currentColor;
    setTool("pen");
  };

  sizeBtns.forEach(b => {
    b.onclick = () => {
      sizeBtns.forEach(x => x.classList.remove("active"));
      b.classList.add("active");
      currentSize = +b.dataset.size;
    };
  });

  resetViewBtn.onclick = resetView;

  chatToggle.onclick = () => chatPanel.classList.toggle("collapsed");
  sendBtn.onclick = sendMessage;
  messageInput.onkeypress = e => e.key === "Enter" && sendMessage();

  canvas.onpointerdown = pointerDown;
  canvas.onpointermove = pointerMove;
  canvas.onpointerup = pointerUp;
  canvas.onpointercancel = pointerUp;
  canvas.onwheel = wheelZoom;

  canvas.oncontextmenu = e => e.preventDefault();
}

/* ================= UI ================= */
function updateUI() {
  drawModeBtn.classList.toggle("active", drawMode);
  drawIndicator.classList.toggle("active", drawMode);
  panIndicator.classList.toggle("active", !drawMode);
  modeLabel.textContent = drawMode ? "Mode Gambar" : "Mode Geser";
  canvas.style.cursor = drawMode ? "crosshair" : "grab";
}

function setTool(tool) {
  currentTool = tool;
  penBtn.classList.toggle("active", tool === "pen");
  eraserBtn.classList.toggle("active", tool === "eraser");
}

/* ================= POINTER ================= */
function pointerDown(e) {
  e.preventDefault();
  activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (drawMode) {
    startDraw(screenToWorld(e.clientX, e.clientY));
  } else {
    if (activeTouches.size === 1) {
      isPanning = true;
      lastPan = { x: e.clientX, y: e.clientY };
    }
    if (activeTouches.size === 2) {
      isPinching = true;
      const t = [...activeTouches.values()];
      lastPinchDist = dist(t[0], t[1]);
    }
  }
}

function pointerMove(e) {
  if (!activeTouches.has(e.pointerId)) return;
  activeTouches.set(e.pointerId, { x: e.clientX, y: e.clientY });

  if (drawMode && isDrawing) {
    continueDraw(screenToWorld(e.clientX, e.clientY));
  }

  if (!drawMode) {
    if (isPinching && activeTouches.size === 2) {
      const t = [...activeTouches.values()];
      const d = dist(t[0], t[1]);
      zoom(d - lastPinchDist, (t[0].x + t[1].x) / 2, (t[0].y + t[1].y) / 2);
      lastPinchDist = d;
    }
    if (isPanning && lastPan) {
      camera.x -= (e.clientX - lastPan.x) / camera.scale;
      camera.y -= (e.clientY - lastPan.y) / camera.scale;
      lastPan = { x: e.clientX, y: e.clientY };
    }
  }
}

function pointerUp(e) {
  e.preventDefault();
  activeTouches.delete(e.pointerId);

  if (drawMode && isDrawing && currentTool === "pen" && currentStroke) {
    if (currentStroke.points.length > 1) {
      push(ref(db, `rooms/${ROOM}/strokes`), currentStroke);
    }
    currentStroke = null;
  }

  isDrawing = false;
  isPanning = false;
  isPinching = false;
  lastPan = null;
}

/* ================= ZOOM ================= */
function wheelZoom(e) {
  if (!drawMode) zoom(-e.deltaY, e.clientX, e.clientY);
}

function zoom(delta, cx, cy) {
  const factor = delta > 0 ? 1.1 : 0.9;
  const prev = camera.scale;
  camera.scale = Math.min(5, Math.max(0.1, camera.scale * factor));
  camera.x += (cx / prev - cx / camera.scale);
  camera.y += (cy / prev - cy / camera.scale);
  zoomPercentEl.textContent = Math.round(camera.scale * 100) + "%";
}

function resetView() {
  camera = { x: 0, y: 0, scale: 1 };
  zoomPercentEl.textContent = "100%";
}

/* ================= DRAW ================= */
function startDraw(p) {
  isDrawing = true;
  if (currentTool === "pen") {
    currentStroke = { points: [p], color: currentColor, size: currentSize, uid };
  } else erase(p);
}

function continueDraw(p) {
  if (currentTool === "pen") currentStroke.points.push(p);
  else erase(p);
}

function erase(p) {
  for (const id in strokes) {
    for (const pt of strokes[id].points) {
      if (dist(pt, p) < currentSize / camera.scale) {
        remove(ref(db, `rooms/${ROOM}/strokes/${id}`));
        return;
      }
    }
  }
}

/* ================= FIREBASE ================= */
function setupFirebase() {
  onValue(ref(db, `rooms/${ROOM}/users`), s => {
    onlineCountEl.textContent = Object.keys(s.val() || {}).length;
  });

  onChildAdded(ref(db, `rooms/${ROOM}/strokes`), s => strokes[s.key] = s.val());
  onValue(ref(db, `rooms/${ROOM}/strokes`), s => strokes = s.val() || {});

  onChildAdded(ref(db, `rooms/${ROOM}/chat`), s => addMessage(s.val()));
  onValue(ref(db, `rooms/${ROOM}/chat`), s => {
    chatCountEl.textContent = Object.keys(s.val() || {}).length;
  });
}

/* ================= CHAT ================= */
function sendMessage() {
  const text = messageInput.value.trim();
  if (!text) return;
  push(ref(db, `rooms/${ROOM}/chat`), { uid, name: userName, text });
  messageInput.value = "";
}

function addMessage(m) {
  const div = document.createElement("div");
  div.className = `message ${m.uid === uid ? "own" : "other"}`;
  div.innerHTML = `<b>${m.uid === uid ? "Anda" : m.name}</b><br>${m.text}`;
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

/* ================= RENDER ================= */
function render() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawGrid();
  Object.values(strokes).forEach(drawStroke);
  if (isDrawing && currentStroke) drawStroke(currentStroke);
  requestAnimationFrame(render);
}

function drawGrid() {
  const s = 40 * camera.scale;
  ctx.strokeStyle = "rgba(0,0,0,.05)";
  for (let x = -camera.x * camera.scale % s; x < canvas.width; x += s) {
    ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, canvas.height); ctx.stroke();
  }
  for (let y = -camera.y * camera.scale % s; y < canvas.height; y += s) {
    ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(canvas.width, y); ctx.stroke();
  }
}

function drawStroke(s) {
  if (!s.points || s.points.length < 2) return;
  ctx.strokeStyle = s.color;
  ctx.lineWidth = s.size * camera.scale;
  ctx.lineCap = "round";
  ctx.beginPath();
  let p = worldToScreen(s.points[0].x, s.points[0].y);
  ctx.moveTo(p.x, p.y);
  for (let i = 1; i < s.points.length; i++) {
    p = worldToScreen(s.points[i].x, s.points[i].y);
    ctx.lineTo(p.x, p.y);
  }
  ctx.stroke();
}

function dist(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
