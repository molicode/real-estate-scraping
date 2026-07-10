/* Administración de jobs de scraping contra la API de GitHub.
 * El token fine-grained se guarda solo en localStorage del navegador. */

const OWNER = "molicode";
const REPO = "real-estate-scraping";
const BRANCH = "main";
const API = `https://api.github.com/repos/${OWNER}/${REPO}`;
const TOKEN_KEY = "resc_token";
const GATE_KEY = "resc_gate";
const THEME_KEY = "resc_theme";

// SHA-256 de "usuario:contraseña". Para cambiar las credenciales generá
// un hash nuevo (en la consola del navegador):
//   await sha256Hex("nuevo-usuario:nueva-clave")
// y reemplazá el valor de abajo. Nota: esto restringe el acceso a la UI,
// pero la protección real es el token de GitHub que cada uno ingresa.
const ACCESS_HASH = "9e932d7a7a91db411c0ba210b2bea230d4953a427132bb0120a0e44be436d365";

const SITE_HINTS = {
  argenprop:
    'Entrá a <a href="https://www.argenprop.com" target="_blank" rel="noopener">argenprop.com</a>, buscá con los filtros del sitio (zona, operación, precio…) y pegá acá la URL de resultados. Ej: https://www.argenprop.com/departamentos/alquiler/palermo',
  mercadolibre:
    '<b class="hint-warn">Ojo:</b> MercadoLibre bloquea a los servidores de GitHub: para scrapearlo hace falta el secret SCRAPERAPI_KEY en el repo (ScraperAPI tiene plan gratuito). Ej: https://inmuebles.mercadolibre.com.ar/departamentos/alquiler/capital-federal/',
  zonaprop:
    '<b class="hint-warn">Ojo:</b> Zonaprop usa protección Cloudflare y suele bloquear a los servidores de GitHub: para scrapearlo hace falta el secret SCRAPERAPI_KEY en el repo (ScraperAPI tiene plan gratuito). Ej: https://www.zonaprop.com.ar/departamentos-alquiler-palermo.html',
  remax:
    'Entrá a <a href="https://www.remax.com.ar" target="_blank" rel="noopener">remax.com.ar</a>, buscá con los filtros del sitio y pegá la URL de resultados (la que empieza con /listings/...). Ej: https://www.remax.com.ar/listings/rent?page=0&pageSize=24&in:operationId=2',
};

let token = localStorage.getItem(TOKEN_KEY) || "";
let jobsDoc = null; // contenido de jobs.json
let jobsSha = null; // sha del archivo para poder commitear
let editingIndex = null; // null = nuevo

const $ = (id) => document.getElementById(id);

/* ---------- Íconos de línea (estilo Lucide, currentColor) ---------- */

const ICONS = {
  home: '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>',
  moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  "log-out": '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>',
  lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
  "chevron-down": '<polyline points="6 9 12 15 18 9"/>',
  "chevron-left": '<polyline points="15 18 9 12 15 6"/>',
  "chevron-right": '<polyline points="9 18 15 12 9 6"/>',
  settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
  star: '<polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26"/>',
  search: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  heart: '<path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>',
  plus: '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  play: '<polygon points="6 4 20 12 6 20"/>',
  stop: '<rect x="6" y="6" width="12" height="12" rx="2"/>',
  pencil: '<path d="M17 3a2.83 2.83 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5z"/><line x1="15" y1="5" x2="19" y2="9"/>',
  trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/><line x1="10" y1="11" x2="10" y2="17"/><line x1="14" y1="11" x2="14" y2="17"/>',
  "list-x": '<line x1="10" y1="6" x2="21" y2="6"/><line x1="10" y1="12" x2="21" y2="12"/><line x1="10" y1="18" x2="16" y2="18"/><path d="m3.5 5 4 4M7.5 5l-4 4"/>',
  refresh: '<path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>',
  x: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  sliders: '<line x1="21" y1="4" x2="14" y2="4"/><line x1="10" y1="4" x2="3" y2="4"/><line x1="21" y1="12" x2="12" y2="12"/><line x1="8" y1="12" x2="3" y2="12"/><line x1="21" y1="20" x2="16" y2="20"/><line x1="12" y1="20" x2="3" y2="20"/><line x1="14" y1="2" x2="14" y2="6"/><line x1="8" y1="10" x2="8" y2="14"/><line x1="16" y1="18" x2="16" y2="22"/>',
  banknote: '<rect x="2" y="6" width="20" height="12" rx="2"/><circle cx="12" cy="12" r="2.5"/><path d="M6 12h.01M18 12h.01"/>',
  ruler: '<path d="M21.3 8.7 8.7 21.3a1 1 0 0 1-1.4 0l-4.6-4.6a1 1 0 0 1 0-1.4L15.3 2.7a1 1 0 0 1 1.4 0l4.6 4.6a1 1 0 0 1 0 1.4Z"/><path d="m7.5 10.5 2 2M10.5 7.5l2 2M13.5 4.5l2 2M4.5 13.5l2 2"/>',
  calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  timer: '<line x1="10" y1="2" x2="14" y2="2"/><line x1="12" y1="14" x2="15" y2="11"/><circle cx="12" cy="14" r="8"/>',
  "file-text": '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/>',
  type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
  rocket: '<path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z"/><path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/>',
  hourglass: '<path d="M5 22h14M5 2h14M17 22v-4.17a2 2 0 0 0-.59-1.42L12 12l-4.41 4.41A2 2 0 0 0 7 17.83V22M7 2v4.17a2 2 0 0 0 .59 1.42L12 12l4.41-4.41A2 2 0 0 0 17 6.17V2"/>',
  wrench: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
  globe: '<circle cx="12" cy="12" r="9"/><line x1="3" y1="12" x2="21" y2="12"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>',
  save: '<path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/>',
  "check-circle": '<path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  "x-circle": '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  circle: '<circle cx="12" cy="12" r="9"/>',
  loader: '<line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/><line x1="4.9" y1="4.9" x2="7.8" y2="7.8"/><line x1="16.2" y1="16.2" x2="19.1" y2="19.1"/><line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/><line x1="4.9" y1="19.1" x2="7.8" y2="16.2"/><line x1="16.2" y1="7.8" x2="19.1" y2="4.9"/>',
  sparkles: '<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/>',
  list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  alert: '<path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  "arrow-right": '<line x1="5" y1="12" x2="19" y2="12"/><polyline points="12 5 19 12 12 19"/>',
  image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
  shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
  "map-pin": '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>',
  info: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};

function icon(name, size = 16) {
  const paths = ICONS[name] || "";
  return `<svg class="ic" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function hydrateIcons(root) {
  (root || document).querySelectorAll("[data-icon]:not([data-ic-done])").forEach((el) => {
    el.innerHTML = icon(el.dataset.icon, Number(el.dataset.iconSize) || 16);
    el.setAttribute("data-ic-done", "");
  });
}

const prefersReducedMotion =
  window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Placeholder cuando no hay foto o la imagen falla al cargar
function noImgHtml(cls) {
  return `<div class="${cls}">${icon("image", 22)}</div>`;
}
window.imgFail = function (img) {
  const thumb = img.classList.contains("thumb");
  const el = document.createElement("div");
  el.className = thumb ? "thumb noimg" : "noimg";
  el.innerHTML = icon("image", 22);
  (img.closest(".pcar") || img).replaceWith(el);
};

/* ---------- API helpers ---------- */

async function gh(path, opts = {}) {
  const resp = await fetch(`${API}${path}`, {
    ...opts,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      ...(opts.headers || {}),
    },
  });
  if (!resp.ok && resp.status !== 404) {
    const body = await resp.text().catch(() => "");
    throw new Error(`GitHub API ${resp.status}: ${body.slice(0, 200)}`);
  }
  return resp;
}

function b64DecodeUtf8(b64) {
  return new TextDecoder().decode(
    Uint8Array.from(atob(b64.replace(/\n/g, "")), (c) => c.charCodeAt(0))
  );
}

function b64EncodeUtf8(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}

async function fetchFile(path) {
  const resp = await gh(`/contents/${path}?ref=${BRANCH}`);
  if (resp.status === 404) return { content: null, sha: null };
  const data = await resp.json();
  return { content: b64DecodeUtf8(data.content), sha: data.sha };
}

async function putFile(path, content, sha, message) {
  const body = { message, content: b64EncodeUtf8(content), branch: BRANCH };
  if (sha) body.sha = sha;
  const resp = await gh(`/contents/${path}`, {
    method: "PUT",
    body: JSON.stringify(body),
  });
  if (resp.status === 404) throw new Error("404 al escribir " + path);
  return (await resp.json()).content.sha;
}

/* ---------- Login (gate de acceso a la UI) ---------- */

async function sha256Hex(str) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
window.sha256Hex = sha256Hex; // para regenerar el hash desde la consola

function unlockApp() {
  $("login-section").classList.add("hidden");
  $("app").classList.remove("hidden");
  $("gate-logout").classList.remove("hidden");
  if (token) connect();
  else $("auth-details").open = true;
}

function showLogin() {
  $("login-section").classList.remove("hidden");
  $("app").classList.add("hidden");
  $("gate-logout").classList.add("hidden");
}

document.getElementById("login-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const user = $("login-user").value.trim();
  const pass = $("login-pass").value;
  const hash = await sha256Hex(`${user}:${pass}`);
  if (hash === ACCESS_HASH) {
    localStorage.setItem(GATE_KEY, hash);
    setStatus($("login-status"), "");
    unlockApp();
  } else {
    setStatus($("login-status"), "Usuario o contraseña incorrectos", "error");
    $("login-pass").value = "";
  }
});

$("gate-logout").addEventListener("click", () => {
  localStorage.removeItem(GATE_KEY);
  location.reload();
});

/* ---------- Tema claro/oscuro ---------- */

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  // en claro ofrece pasar a oscuro (luna); en oscuro ofrece pasar a claro (sol)
  $("theme-icon").innerHTML = icon(theme === "light" ? "moon" : "sun", 16);
  localStorage.setItem(THEME_KEY, theme);
}

$("theme-toggle").addEventListener("click", () => {
  applyTheme(document.documentElement.dataset.theme === "light" ? "dark" : "light");
});

/* ---------- Conexión con GitHub ---------- */

function setStatus(el, msg, cls = "") {
  el.textContent = msg;
  el.className = "status " + cls;
}

function setConnState(state, text) {
  // state: "green" | "yellow" | "red"
  $("auth-dot").className = `dot ${state}`;
  $("auth-summary-text").textContent = text;
}

async function connect() {
  if (!token) return;
  setConnState("yellow", "Verificando conexión...");
  setStatus($("auth-status"), "Verificando acceso al repo...");
  try {
    const resp = await gh("");
    if (resp.status === 404) throw new Error("El token no ve el repositorio (¿le diste acceso a este repo?)");
    const repo = await resp.json();
    setConnState("green", `Conectado a ${repo.full_name}`);
    setStatus($("auth-status"), `Conectado a ${repo.full_name}`, "ok");
    $("token-input").value = "••••••••";
    $("token-save").classList.add("hidden");
    $("token-clear").classList.remove("hidden");
    $("auth-details").open = false; // colapsar: el semáforo ya informa
    $("tabs").classList.remove("hidden");
    $("main").classList.remove("hidden");
    await loadJobs();
    // Cargar la base de delitos en segundo plano para los puntos de
    // seguridad en las tarjetas de jobs y el label del formulario.
    loadCrimeData().then(() => { if (jobsDoc) renderJobs(); });
  } catch (err) {
    setConnState("red", "Error de conexión con GitHub");
    setStatus($("auth-status"), "" + err.message, "error");
    $("auth-details").open = true;
  }
}

$("token-save").addEventListener("click", () => {
  const val = $("token-input").value.trim();
  if (!val || val.startsWith("•")) return;
  token = val;
  localStorage.setItem(TOKEN_KEY, token);
  connect();
});

$("token-clear").addEventListener("click", () => {
  localStorage.removeItem(TOKEN_KEY);
  location.reload();
});

/* ---------- Tabs ---------- */

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    $(`tab-${btn.dataset.tab}`).classList.remove("hidden");
    if (btn.dataset.tab === "results" && !$("results-list").innerHTML) loadResults();
    if (btn.dataset.tab === "top" && !$("top-rent").innerHTML) loadResults();
    if (btn.dataset.tab === "fav" && !$("fav-list").innerHTML) loadFavorites().then(renderFavorites);
    if (btn.dataset.tab === "risk" && !$("zones-list").innerHTML) {
      loadRiskData().then(renderZones);
      loadCrimeData().then(renderCrimeMap);
    }
    if (btn.dataset.tab === "runs" && !$("runs-list").innerHTML) loadRuns();
  });
});

/* ---------- Jobs ---------- */

async function loadJobs() {
  setStatus($("jobs-status"), "Cargando jobs...");
  try {
    const { content, sha } = await fetchFile("jobs.json");
    jobsSha = sha;
    jobsDoc = content
      ? JSON.parse(content)
      : { retention_days: 365, defaults: { max_pages: 2 }, searches: [] };
    if (!Array.isArray(jobsDoc.searches)) jobsDoc.searches = [];
    renderJobs();
    setStatus($("jobs-status"), `${jobsDoc.searches.length} jobs`);
  } catch (err) {
    setStatus($("jobs-status"), "" + err.message, "error");
  }
}

function fmtFilters(f = {}) {
  const parts = [];
  if (f.currency) parts.push(f.currency);
  if (f.min_price != null) parts.push(`desde ${f.min_price.toLocaleString("es-AR")}`);
  if (f.max_price != null) parts.push(`hasta ${f.max_price.toLocaleString("es-AR")}`);
  if (f.min_rooms) parts.push(`${f.min_rooms}+ amb`);
  if (f.max_rooms) parts.push(`máx ${f.max_rooms} amb`);
  if (f.min_bedrooms) parts.push(`${f.min_bedrooms}+ dorm`);
  if (f.min_bathrooms) parts.push(`${f.min_bathrooms}+ baños`);
  if (f.min_surface_m2) parts.push(`${f.min_surface_m2}+ m²`);
  if (f.require_price) parts.push("con precio");
  if (f.keywords_include?.length) parts.push(`incluye: ${f.keywords_include.join(", ")}`);
  if (f.keywords_exclude?.length) parts.push(`excluye: ${f.keywords_exclude.join(", ")}`);
  return parts.join(" · ") || "sin filtros extra";
}

const PTYPE_LABEL = {
  departamento: "depto", casa: "casa", ph: "PH",
  local: "local", oficina: "oficina", terreno: "terreno",
};

// Tipo de propiedad del job: guardado (modo menú) o derivado de la URL
function jobPtype(job) {
  if (job.ptype) return PTYPE_LABEL[job.ptype] || job.ptype;
  const u = (job.url || "").toLowerCase();
  if (/\bdepartamento|deptos?\b/.test(u)) return "depto";
  if (/\bcasas?\b/.test(u)) return "casa";
  if (/\bph\b/.test(u)) return "PH";
  if (/local/.test(u)) return "local";
  if (/oficina/.test(u)) return "oficina";
  if (/terreno/.test(u)) return "terreno";
  return null;
}

// Zona/barrio del job: guardada o buscada en la URL
function jobZone(job) {
  if (job.zone) return job.zone.replace(/-/g, " ");
  const hay = normZone(job.url || "");
  for (const b of Object.keys(BARRIO_COMUNA).sort((a, z) => z.length - a.length)) {
    if (hay.includes(b)) return b;
  }
  if (hay.includes("capital-federal") || hay.includes("capital federal")) return "capital federal";
  return null;
}

// Punto de color con el nivel de inseguridad de la zona (si hay datos)
function zoneDot(job) {
  if (!crimeData) return "";
  const comuna = comunaFromZone(job.zone || job.url || "");
  const info = comuna && crimeData.comunas[String(comuna)];
  if (!info) return "";
  const dot = (LEVEL_INFO[info.level] || {}).dot || "";
  return `<span class="dot ${dot}" title="Seguridad: ${(LEVEL_INFO[info.level] || {}).txt}"></span>`;
}

function renderJobs() {
  const wrap = $("jobs-list");
  // conservar qué desplegables estaban abiertos al re-renderizar
  const openIdx = new Set(
    [...wrap.querySelectorAll("details.job-card")]
      .map((d, i) => (d.open ? i : -1))
      .filter((i) => i >= 0)
  );
  wrap.innerHTML = "";
  if (!jobsDoc.searches.length) {
    wrap.innerHTML = '<p class="status">No hay jobs todavía. Creá el primero con "Nuevo job".</p>';
  }
  jobsDoc.searches.forEach((job, i) => {
    const enabled = job.enabled !== false;
    const det = document.createElement("details");
    det.className = "job-card" + (enabled ? "" : " disabled");
    det.open = openIdx.has(i);
    const every = Math.max(1, Number(job.every_hours) || 1);
    det.innerHTML = `
      <summary>
        <span class="dot ${enabled ? "green" : "yellow"}" title="${enabled ? "Activo" : "Detenido"}"></span>
        <span class="badge ${enabled ? "on" : "off"}">${enabled ? "ACTIVO" : "DETENIDO"}</span>
        <span class="badge">${job.site || "?"}</span>
        <span class="badge">${job.operation === "venta" ? "compra" : job.operation || "?"}</span>
        ${jobPtype(job) ? `<span class="badge">${escapeHtml(jobPtype(job))}</span>` : ""}
        ${jobZone(job) ? `<span class="badge">${zoneDot(job)}${escapeHtml(jobZone(job))}</span>` : ""}
        <span class="badge" title="Frecuencia con la que corre en el cron">${icon("timer", 13)} cada ${every} h</span>
        <span class="job-name">${escapeHtml(job.name || `job ${i + 1}`)}</span>
        <span class="summary-hint">detalles ${icon("chevron-down", 14)}</span>
      </summary>
      <div class="details-body">
        <div class="meta"><strong>Filtros:</strong> ${escapeHtml(fmtFilters(job.filters))}</div>
        <div class="meta">${job.max_pages || 1} ${job.max_pages === 1 ? "página" : "páginas"} por corrida</div>
        <div class="row">
          <button class="btn small" data-act="toggle" data-i="${i}" title="${enabled ? "Deja de ejecutarse en el cron (se guarda al instante)" : "Vuelve a la programación (se guarda al instante)"}">${enabled ? icon("stop") + " Detener" : icon("play") + " Activar"}</button>
          <button class="btn small" data-act="run" data-i="${i}" title="Ejecuta SOLO este job ahora mismo, aunque esté detenido">${icon("play")} Ejecutar ahora</button>
          <button class="btn small" data-act="edit" data-i="${i}">${icon("pencil")} Editar</button>
          <button class="btn small" data-act="clone" data-i="${i}" title="Crear un job nuevo copiando este (filtros, tipo, zona, frecuencia). Después cambiás lo que quieras, ej. el portal.">${icon("copy")} Clonar</button>
          <button class="btn small danger" data-act="del" data-i="${i}">${icon("trash")} Eliminar</button>
        </div>
        <div class="job-flow" id="job-flow-${i}"></div>
      </div>`;
    wrap.appendChild(det);
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

$("jobs-list").addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const act = btn.dataset.act;
  if (act === "toggle") {
    // Detener/Activar tiene efecto inmediato: se guarda solo
    const job = jobsDoc.searches[i];
    job.enabled = job.enabled === false;
    renderJobs();
    await persistJobs(
      `${job.enabled ? "Activado" : "Detenido"} "${job.name}"`
    );
  } else if (act === "run") {
    runSingleJob(jobsDoc.searches[i], i);
  } else if (act === "clone") {
    openForm(null, JSON.parse(JSON.stringify(jobsDoc.searches[i])));
  } else if (act === "del") {
    const name = jobsDoc.searches[i].name;
    if (confirm(`¿Eliminar el job "${name}"? Se guarda al instante.`)) {
      jobsDoc.searches.splice(i, 1);
      renderJobs();
      await persistJobs(`Eliminado "${name}"`);
    }
  } else if (act === "edit") {
    openForm(i);
  }
});

async function runSingleJob(job, index) {
  setStatus($("jobs-status"), `Disparando "${job.name}"...`);
  try {
    const dispatchedAt = new Date().toISOString();
    const resp = await gh(`/actions/workflows/scraper.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: BRANCH, inputs: { only_job: job.name } }),
    });
    if (resp.status !== 204) throw new Error(`status ${resp.status}`);
    setStatus($("jobs-status"), `"${job.name}" disparado`, "ok");
    // El flujo se muestra dentro del propio job (abrimos su desplegable)
    const card = document.querySelectorAll("#jobs-list details.job-card")[index];
    if (card) card.open = true;
    watchRun($(`job-flow-${index}`), `Ejecutando "${job.name}"`, dispatchedAt);
  } catch (err) {
    setStatus($("jobs-status"), "" + err.message, "error");
  }
}

/* ---------- Flujo animado de la corrida en curso ----------
 * Cada disparo tiene su propio watcher y su propio contenedor (el panel
 * global para "Ejecutar scraper ahora", o el desplegable del job).
 * Si se disparan varios, las corridas se encolan en GitHub (no corren en
 * paralelo) y cada watcher reclama una corrida distinta. */

const FLOW_STEPS = [
  { ic: "rocket", label: "Disparado" },
  { ic: "hourglass", label: "En cola" },
  { ic: "wrench", label: "Preparando entorno" },
  { ic: "globe", label: "Scrapeando portales" },
  { ic: "save", label: "Guardando resultados" },
  { ic: "check-circle", label: "Listo" },
];
const claimedRuns = new Set();

function renderFlow(container, title, activeIdx, finished = false, resultHtml = "") {
  if (!container) return;
  const steps = FLOW_STEPS.map((step, i) => {
    const cls = finished || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
    return `<div class="flow-step ${cls}"><span class="flow-dot">${icon(step.ic, 14)}</span><span class="flow-label">${step.label}</span></div>`;
  }).join('<div class="flow-line"></div>');
  container.classList.remove("hidden");
  container.innerHTML = `
    <div class="flow-title">${escapeHtml(title)}</div>
    <div class="flow-track">${steps}</div>
    ${resultHtml ? `<div class="flow-result">${resultHtml}</div>` : ""}`;
}

function watchRun(container, title, dispatchedAt) {
  renderFlow(container, title, 0);
  let runId = null;
  let ticks = 0;
  const timer = setInterval(async () => {
    if (++ticks > 90) { // ~7 minutos de vigilancia máxima
      clearInterval(timer);
      renderFlow(container, title, FLOW_STEPS.length - 1, true, "La corrida sigue en GitHub; mirá la pestaña Corridas.");
      return;
    }
    try {
      if (!runId) {
        const resp = await gh(`/actions/workflows/scraper.yml/runs?event=workflow_dispatch&per_page=5`);
        const runs = ((await resp.json()).workflow_runs || [])
          .filter((r) => r.created_at >= dispatchedAt.slice(0, 19) && !claimedRuns.has(r.id))
          .sort((a, b) => (a.created_at || "").localeCompare(b.created_at || ""));
        if (runs.length) {
          runId = runs[0].id;
          claimedRuns.add(runId);
          renderFlow(container, title, 1);
        }
        return;
      }
      const resp = await gh(`/actions/runs/${runId}/jobs`);
      const job = (await resp.json()).jobs?.[0];
      if (!job || job.status === "queued") { renderFlow(container, title, 1); return; }
      if (job.status === "in_progress") {
        const steps = job.steps || [];
        const running = (name) =>
          steps.some((s) => s.name.includes(name) && s.status === "in_progress");
        const doneStep = (name) =>
          steps.some((s) => s.name.includes(name) && s.status === "completed");
        if (running("Commitear") || doneStep("Ejecutar scraper")) renderFlow(container, title, 4);
        else if (running("Ejecutar scraper")) renderFlow(container, title, 3);
        else renderFlow(container, title, 2);
        return;
      }
      if (job.status === "completed") {
        clearInterval(timer);
        const ok = job.conclusion === "success";
        let result = escapeHtml("La corrida falló — abrí el log desde la pestaña Corridas.");
        if (ok) {
          const history = await loadRunHistory();
          const h = history[history.length - 1];
          result = h && h.finished_at >= dispatchedAt.slice(0, 19)
            ? `${icon("sparkles", 14)} ${h.new} avisos nuevos · ${icon("list", 14)} ${h.found} encontrados` +
              (h.errors?.length ? ` · ${icon("alert", 14)} ${h.errors.length} avisos de error` : "")
            : "Completado (sin actividad registrada).";
          loadResults(); // refresca Buscar y Top con lo nuevo
        }
        renderFlow(container, title, FLOW_STEPS.length - 1, ok, result);
      }
    } catch { /* reintenta en el próximo tick */ }
  }, 5000);
}


/* ---------- Formulario ---------- */

function detectSite(url) {
  if (url.includes("argenprop")) return "argenprop";
  if (url.includes("zonaprop")) return "zonaprop";
  if (url.includes("mercadolibre")) return "mercadolibre";
  if (url.includes("remax")) return "remax";
  return null;
}

/* ---------- Armador de URLs por menús ---------- */

// Slug del tipo de propiedad según el portal
const PTYPE_SLUGS = {
  departamento: { argenprop: "departamentos", mercadolibre: "departamentos", zonaprop: "departamentos" },
  casa: { argenprop: "casas", mercadolibre: "casas", zonaprop: "casas" },
  ph: { argenprop: "ph", mercadolibre: "ph", zonaprop: "ph" },
  local: { argenprop: "locales", mercadolibre: "locales", zonaprop: "locales-comerciales" },
  oficina: { argenprop: "oficinas", mercadolibre: "oficinas", zonaprop: "oficinas-comerciales" },
  terreno: { argenprop: "terrenos", mercadolibre: "terrenos", zonaprop: "terrenos" },
};

function slugifyZone(zone) {
  return zone
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // sin acentos
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-");
}

function buildSearchUrl(site, operation, ptype, zone) {
  const t = PTYPE_SLUGS[ptype]?.[site];
  const z = slugifyZone(zone || "") || "capital-federal";
  const op = operation === "venta" ? "venta" : "alquiler";
  switch (site) {
    case "argenprop":
      return `https://www.argenprop.com/${t}/${op}/${z}`;
    case "mercadolibre":
      return `https://inmuebles.mercadolibre.com.ar/${t}/${op}/${z}/`;
    case "zonaprop":
      return `https://www.zonaprop.com.ar/${t}-${op}-${z}.html`;
    case "remax": {
      // Remax no tiene URLs por slug: se arma la búsqueda general por
      // operación; la zona se filtra en el sitio (modo 'Pegar URL').
      const opId = operation === "venta" ? 1 : 2;
      const path = operation === "venta" ? "buy" : "rent";
      return `https://www.remax.com.ar/listings/${path}?page=0&pageSize=24&sort=-createdAt&in:operationId=${opId}`;
    }
    default:
      return "";
  }
}

function isMenuMode() {
  return $("f-mode").value === "menu";
}

function syncBuilder() {
  const menu = isMenuMode();
  $("wrap-ptype").classList.toggle("hidden", !menu);
  $("wrap-zone").classList.toggle("hidden", !menu);
  $("f-url").readOnly = menu;
  if (menu) {
    $("f-url").value = buildSearchUrl(
      $("f-site").value, $("f-operation").value, $("f-ptype").value, $("f-zone").value
    );
  }
  updateHint();
  updateZoneSecurity();
  updateAutoName();
}

["f-mode", "f-site", "f-operation", "f-ptype"].forEach((id) =>
  $(id).addEventListener("change", syncBuilder)
);
$("f-zone").addEventListener("input", syncBuilder);

// Los <datalist> nativos filtran las opciones por el texto actual del input:
// si el campo ya trae "caballito", al enfocarlo el navegador solo ofrece esa
// opción (parece que "no muestra nada" al querer cambiar la zona en un job
// que se edita o clona). Para ver la lista completa al entrar, vaciamos el
// valor al enfocar y lo restauramos al salir si no se eligió/escribió otro.
(() => {
  const zi = $("f-zone");
  const reveal = () => {
    if (zi.dataset.prev === undefined) zi.dataset.prev = zi.value;
    if (zi.value !== "") zi.value = "";
  };
  zi.addEventListener("mousedown", reveal);
  zi.addEventListener("focus", reveal);
  zi.addEventListener("blur", () => {
    if (zi.value.trim() === "" && zi.dataset.prev) {
      zi.value = zi.dataset.prev;
      syncBuilder();
    }
    delete zi.dataset.prev;
  });
})();

function updateHint() {
  const hint = SITE_HINTS[$("f-site").value] || "";
  $("site-hint").innerHTML = hint.startsWith("<b")
    ? `<span class="hint-warn-ic">${icon("alert", 14)}</span> ${hint}`
    : hint;
}
$("f-site").addEventListener("change", updateHint);
$("f-url").addEventListener("input", () => {
  const s = detectSite($("f-url").value);
  if (s) {
    $("f-site").value = s;
    updateHint();
  }
});

/* ---------- Nombre automático PORTAL___OPERACION___TIPO___ZONA ---------- */

let autoNameOn = true;

function ptypeFromUrl(u) {
  u = (u || "").toLowerCase();
  if (/departamento|deptos?/.test(u)) return "departamento";
  if (/casas?/.test(u)) return "casa";
  if (/\bph\b/.test(u)) return "ph";
  if (/local/.test(u)) return "local";
  if (/oficina/.test(u)) return "oficina";
  if (/terreno/.test(u)) return "terreno";
  return null;
}
function slugPart(s) { return normZone(s || "").replace(/\s+/g, "-"); }

function formAutoName() {
  const site = $("f-site").value;
  const op = $("f-operation").value;
  let ptype, zone;
  if (isMenuMode()) { ptype = $("f-ptype").value; zone = $("f-zone").value.trim(); }
  else { ptype = ptypeFromUrl($("f-url").value); zone = jobZone({ url: $("f-url").value }); }
  return [site, op, ptype || "propiedad", slugPart(zone) || "todos"].join("_");
}
function jobAutoName(job) {
  const ptype = job.ptype || ptypeFromUrl(job.url) || "propiedad";
  const zone = job.zone || jobZone(job) || "todos";
  return [job.site, job.operation || "alquiler", ptype, slugPart(zone) || "todos"].join("_");
}
function updateAutoName() {
  if (autoNameOn) $("f-name").value = formAutoName();
}

function openForm(index, prefill) {
  editingIndex = index;
  const job = prefill || (index != null ? jobsDoc.searches[index] : null);
  const cloning = Boolean(prefill);
  $("job-form-title").textContent = cloning ? "Clonar job" : job ? `Editar: ${job.name}` : "Nuevo job";
  const f = job?.filters || {};
  // Nombre: automático salvo que el job existente tenga uno propio (no-auto)
  autoNameOn = !job || cloning || job.name === jobAutoName(job);
  $("f-name").value = job?.name || "";
  $("f-site").value = job?.site || "argenprop";
  $("f-operation").value = job?.operation === "venta" ? "venta" : "alquiler";
  // Modo de la búsqueda: se respeta el que tenía el job. Nuevo -> menú.
  // Editar/clonar -> el guardado (job.mode); para jobs viejos sin ese campo
  // se deduce: si tiene ptype fue armado con menús, si no, con URL pegada.
  $("f-mode").value = !job ? "menu" : (job.mode || (job.ptype ? "menu" : "url"));
  $("f-ptype").value = job?.ptype || "departamento";
  $("f-zone").value = job?.zone || "";
  $("f-url").value = job?.url || "";
  $("f-max-pages").value = job?.max_pages ?? jobsDoc.defaults?.max_pages ?? 2;
  $("f-every").value = String(Math.max(1, Number(job?.every_hours) || 1));
  $("f-enabled").value = String(job ? job.enabled !== false : true);
  $("f-currency").value = f.currency || "";
  $("f-min-price").value = f.min_price ?? "";
  $("f-max-price").value = f.max_price ?? "";
  $("f-min-rooms").value = f.min_rooms ?? "";
  $("f-max-rooms").value = f.max_rooms ?? "";
  $("f-min-bedrooms").value = f.min_bedrooms ?? "";
  $("f-min-bathrooms").value = f.min_bathrooms ?? "";
  $("f-min-surface").value = f.min_surface_m2 ?? "";
  $("f-require-price").value = String(!!f.require_price);
  $("f-kw-include").value = (f.keywords_include || []).join(", ");
  $("f-kw-exclude").value = (f.keywords_exclude || []).join(", ");
  syncBuilder();
  updateAutoName();
  $("job-form-wrap").classList.remove("hidden");
  $("f-name").focus();
}

// Si el usuario escribe un nombre, deja de autogenerarse
$("f-name").addEventListener("input", () => { autoNameOn = false; });

$("new-job").addEventListener("click", () => openForm(null));
$("job-cancel").addEventListener("click", () => $("job-form-wrap").classList.add("hidden"));

// Chips de palabras clave sugeridas: agregan al input sin duplicar
document.querySelectorAll(".chip-row").forEach((row) => {
  row.addEventListener("click", (e) => {
    const chip = e.target.closest(".chip");
    if (!chip) return;
    const input = $(row.dataset.target);
    const values = input.value.split(",").map((s) => s.trim()).filter(Boolean);
    if (!values.includes(chip.dataset.kw)) {
      values.push(chip.dataset.kw);
      input.value = values.join(", ");
    }
  });
});

function numOrNull(id) {
  const v = $(id).value.trim();
  return v === "" ? null : Number(v);
}

function csv(id) {
  return $(id).value.split(",").map((s) => s.trim()).filter(Boolean);
}

$("job-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const url = $("f-url").value.trim();
  const site = detectSite(url);
  if (!site) {
    alert("La URL debe ser de argenprop.com, zonaprop.com.ar, mercadolibre.com.ar o remax.com.ar");
    return;
  }
  const filters = {};
  if ($("f-currency").value) filters.currency = $("f-currency").value;
  for (const [key, id] of [
    ["min_price", "f-min-price"], ["max_price", "f-max-price"],
    ["min_rooms", "f-min-rooms"], ["max_rooms", "f-max-rooms"],
    ["min_bedrooms", "f-min-bedrooms"], ["min_bathrooms", "f-min-bathrooms"],
    ["min_surface_m2", "f-min-surface"],
  ]) {
    const v = numOrNull(id);
    if (v != null) filters[key] = v;
  }
  if ($("f-require-price").value === "true") filters.require_price = true;
  const inc = csv("f-kw-include");
  const exc = csv("f-kw-exclude");
  if (inc.length) filters.keywords_include = inc;
  if (exc.length) filters.keywords_exclude = exc;

  const job = {
    name: $("f-name").value.trim() || formAutoName(),
    url,
    site,
    operation: $("f-operation").value,
    enabled: $("f-enabled").value === "true",
    max_pages: numOrNull("f-max-pages") || 1,
    every_hours: Number($("f-every").value) || 1,
    filters,
  };
  // Tipo y zona para mostrar en la tarjeta. En modo menú se toman de los
  // selectores; al editar (modo URL) se conservan los que ya tenía el job.
  const prev = editingIndex != null ? jobsDoc.searches[editingIndex] : {};
  job.mode = isMenuMode() ? "menu" : "url";  // se recuerda para reabrir el editor igual
  if (isMenuMode()) {
    job.ptype = $("f-ptype").value;
    const zone = $("f-zone").value.trim();
    if (zone) job.zone = zone;
  } else {
    if (prev.ptype) job.ptype = prev.ptype;
    if (prev.zone) job.zone = prev.zone;
  }
  const isNew = editingIndex == null;
  if (isNew) jobsDoc.searches.push(job);
  else jobsDoc.searches[editingIndex] = job;
  $("job-form-wrap").classList.add("hidden");
  renderJobs();
  persistJobs(isNew ? `Job "${job.name}" creado` : `Job "${job.name}" actualizado`);
});

/* ---------- Guardar + ejecutar ---------- */

async function persistJobs(okMessage) {
  setStatus($("jobs-status"), "Guardando jobs.json...");
  try {
    jobsSha = await putFile(
      "jobs.json",
      JSON.stringify(jobsDoc, null, 2) + "\n",
      jobsSha,
      "chore: actualizar jobs desde la web de administración"
    );
    renderJobs();
    setStatus($("jobs-status"), `${okMessage || "Guardado"}. El cron ya usa esta config.`, "ok");
  } catch (err) {
    // sha viejo (otro guardado en el medio): refrescar y reintentar una vez
    try {
      const { sha } = await fetchFile("jobs.json");
      jobsSha = await putFile(
        "jobs.json",
        JSON.stringify(jobsDoc, null, 2) + "\n",
        sha,
        "chore: actualizar jobs desde la web de administración"
      );
      renderJobs();
      setStatus($("jobs-status"), `${okMessage || "Guardado"}.`, "ok");
    } catch (err2) {
      setStatus($("jobs-status"), "No se pudo guardar: " + err2.message, "error");
      alert("No se pudo guardar jobs.json: " + err2.message);
    }
  }
}

$("run-now").addEventListener("click", async () => {
  const active = (jobsDoc?.searches || []).filter((s) => s.enabled !== false).length;
  if (active === 0 && !confirm("Tenés 0 jobs activos: la corrida no va a scrapear nada. ¿Ejecutar igual?")) return;
  setStatus($("jobs-status"), "Disparando workflow...");
  try {
    const dispatchedAt = new Date().toISOString();
    const resp = await gh(`/actions/workflows/scraper.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: BRANCH }),
    });
    if (resp.status !== 204) throw new Error(`status ${resp.status}`);
    setStatus($("jobs-status"), `Scraper disparado (${active} jobs activos).`, "ok");
    watchRun($("run-flow"), `Ejecutando ${active} jobs activos`, dispatchedAt);
  } catch (err) {
    setStatus($("jobs-status"), "" + err.message, "error");
  }
});

/* ---------- Buscador sobre los avisos guardados ---------- */

let allListings = [];

async function loadResults() {
  setStatus($("results-status"), "Cargando resultados...");
  try {
    const resp = await gh(`/contents/data/listings.json?ref=${BRANCH}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    });
    if (resp.status === 404) {
      allListings = [];
      $("results-list").innerHTML = '<p class="status">Todavía no hay resultados (data/listings.json no existe).</p>';
      setStatus($("results-status"), "");
      return;
    }
    allListings = Object.values(await resp.json());
    if (!favLoaded) await loadFavorites();
    if (!riskLoaded) await loadRiskData();
    populateSearchSelects();
    applySearch();
    renderTop();
  } catch (err) {
    setStatus($("results-status"), "" + err.message, "error");
    setStatus($("top-status"), "" + err.message, "error");
  }
}

function fillSelect(sel, values) {
  const current = sel.value;
  sel.innerHTML =
    '<option value="">Todos</option>' +
    values.map((v) => `<option value="${escapeHtml(v)}">${escapeHtml(v)}</option>`).join("");
  sel.value = current;
}

function populateSearchSelects() {
  fillSelect($("s-site"), [...new Set(allListings.map((l) => l.site).filter(Boolean))].sort());
  fillSelect($("s-job"), [...new Set(allListings.map((l) => l.search_name).filter(Boolean))].sort());
}

function numVal(id) {
  const v = $(id).value.trim();
  return v === "" ? null : Number(v);
}

function pricePerM2(l) {
  return l.price_amount != null && l.surface_m2 ? l.price_amount / l.surface_m2 : null;
}

function applySearch() {
  const q = $("s-text").value.trim().toLowerCase();
  const qNot = $("s-text-exclude").value.trim().toLowerCase();
  const site = $("s-site").value;
  const job = $("s-job").value;
  const operation = $("s-operation").value;
  const currency = $("s-currency").value;
  const pmin = numVal("s-min-price");
  const pmax = numVal("s-max-price");
  const requirePrice = $("s-require-price").value === "yes";
  const rooms = numVal("s-min-rooms");
  const roomsMax = numVal("s-max-rooms");
  const beds = numVal("s-min-bedrooms");
  const baths = numVal("s-min-bathrooms");
  const surf = numVal("s-min-surface");
  const surfMax = numVal("s-max-surface");
  const withPhoto = $("s-with-photo").value === "yes";
  const onlyFav = $("s-only-fav").value === "yes";
  const risk = $("s-risk").value;
  const since = $("s-since").value; // yyyy-mm-dd, comparable con first_seen ISO

  const out = allListings.filter((l) => {
    const haystack = `${l.title} ${l.address} ${l.search_name}`.toLowerCase();
    if (q && !haystack.includes(q)) return false;
    if (qNot && haystack.includes(qNot)) return false;
    if (site && l.site !== site) return false;
    if (job && l.search_name !== job) return false;
    if (operation && listingOperation(l) !== operation) return false;
    if (currency && l.price_currency !== currency) return false;
    if (requirePrice && l.price_amount == null) return false;
    if (pmin != null && !(l.price_amount != null && l.price_amount >= pmin)) return false;
    if (pmax != null && !(l.price_amount != null && l.price_amount <= pmax)) return false;
    if (rooms != null && !(l.rooms != null && l.rooms >= rooms)) return false;
    if (roomsMax != null && l.rooms != null && l.rooms > roomsMax) return false;
    if (beds != null && !(l.bedrooms != null && l.bedrooms >= beds)) return false;
    if (baths != null && !(l.bathrooms != null && l.bathrooms >= baths)) return false;
    if (surf != null && !(l.surface_m2 != null && l.surface_m2 >= surf)) return false;
    if (surfMax != null && l.surface_m2 != null && l.surface_m2 > surfMax) return false;
    if (withPhoto && !l.image) return false;
    if (onlyFav && !isFav(l.id)) return false;
    if (since && (l.first_seen || "") < since) return false;
    if (risk) {
      const rank = riskLevelRank(l);
      if (risk === "flagged" && rank === 0) return false;
      if (risk === "hide-high" && rank === 3) return false;
      if (risk === "only-high" && rank !== 3) return false;
    }
    return true;
  });

  const sorters = {
    recent: (a, b) => (b.first_seen || "").localeCompare(a.first_seen || ""),
    oldest: (a, b) => (a.first_seen || "").localeCompare(b.first_seen || ""),
    price_asc: (a, b) => (a.price_amount ?? Infinity) - (b.price_amount ?? Infinity),
    price_desc: (a, b) => (b.price_amount ?? -1) - (a.price_amount ?? -1),
    ppm2_asc: (a, b) => (pricePerM2(a) ?? Infinity) - (pricePerM2(b) ?? Infinity),
    surface_desc: (a, b) => (b.surface_m2 ?? -1) - (a.surface_m2 ?? -1),
  };
  out.sort(sorters[$("s-sort").value] || sorters.recent);

  renderResults(out);
  setStatus($("results-status"), `${out.length} de ${allListings.length} avisos`);
}

/* Vaciar todo el histórico de avisos guardados */
$("clear-history").addEventListener("click", async () => {
  if (!confirm(
    `¿Vaciar TODO el histórico (${allListings.length} avisos guardados)?\n` +
    `Tus favoritos NO se tocan. Los avisos que sigan publicados van a ` +
    `volver a aparecer en futuras corridas.`
  )) return;
  setStatus($("results-status"), "Vaciando histórico...");
  try {
    const { sha } = await fetchFile("data/listings.json");
    await putFile("data/listings.json", "{}\n", sha, "chore: vaciar histórico de avisos desde la web");
    allListings = [];
    populateSearchSelects();
    applySearch();
    renderTop();
    setStatus($("results-status"), "Histórico vaciado", "ok");
  } catch (err) {
    setStatus($("results-status"), "" + err.message, "error");
    alert("No pude vaciar el histórico: " + err.message);
  }
});

function fmtPrice(l) {
  if (l.price_amount == null) return "consultar";
  const cur = l.price_currency === "USD" ? "USD" : "$";
  return `${cur} ${Number(l.price_amount).toLocaleString("es-AR")}`;
}

/* ---------- Favoritos (Me gustan) ---------- */

let favorites = {};
let favSha = null;
let favLoaded = false;
let favQueue = Promise.resolve(); // serializa los commits de favoritos

async function loadFavorites() {
  try {
    const { content, sha } = await fetchFile("data/favorites.json");
    favSha = sha;
    favorites = content ? JSON.parse(content) : {};
  } catch {
    favorites = {};
  }
  favLoaded = true;
}

function isFav(id) {
  return Boolean(favorites[id]);
}

function heartHtml(l) {
  const on = isFav(l.id);
  return `<button class="fav-btn${on ? " on" : ""}" data-fav="${escapeHtml(l.id)}"
    title="${on ? "Quitar de Me gustan" : "Guardar en Me gustan"}">${icon("heart", 18)}</button>`;
}

function refreshHearts() {
  document.querySelectorAll("button[data-fav]").forEach((btn) => {
    const on = isFav(btn.dataset.fav);
    btn.classList.toggle("on", on);
    btn.title = on ? "Quitar de Me gustan" : "Guardar en Me gustan";
  });
}

function toggleFavorite(id) {
  if (isFav(id)) {
    delete favorites[id];
  } else {
    const listing = allListings.find((l) => l.id === id);
    if (!listing) return;
    favorites[id] = {
      ...listing,
      saved_at: new Date().toISOString().slice(0, 19) + "Z",
    };
  }
  refreshHearts();
  renderFavorites();
  setStatus($("fav-status"), "Guardando en el repo...");
  favQueue = favQueue.then(saveFavorites).catch(() => {});
}

async function saveFavorites() {
  const body = JSON.stringify(favorites, null, 2) + "\n";
  const message = "chore: actualizar favoritos desde la web";
  try {
    favSha = await putFile("data/favorites.json", body, favSha, message);
  } catch (err) {
    // sha desactualizado (otro navegador guardó en el medio): refrescar y reintentar
    try {
      const { sha } = await fetchFile("data/favorites.json");
      favSha = await putFile("data/favorites.json", body, sha, message);
    } catch (err2) {
      setStatus($("fav-status"), "No pude guardar: " + err2.message, "error");
      return;
    }
  }
  setStatus($("fav-status"), `${Object.keys(favorites).length} favoritos guardados en el repo`, "ok");
}

document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-fav]");
  if (!btn) return;
  e.preventDefault();
  toggleFavorite(btn.dataset.fav);
});

function favCardHtml(l) {
  const meta = [
    l.rooms ? `${l.rooms} amb` : null,
    l.surface_m2 ? `${Math.round(l.surface_m2)} m²` : null,
  ].filter(Boolean).join(" · ");
  const extra = `<button class="fav-btn on thumb-fav" data-fav="${escapeHtml(l.id)}" title="Quitar de Me gustan">${icon("heart", 16)}</button>`;
  return `
    <div class="top-card">
      <div class="top-thumb">${photoCarouselHtml(l, extra)}</div>
      <div class="top-body">
        <div class="top-price">${fmtPrice(l)}</div>
        <a class="top-title" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a>
        <div class="top-meta">${escapeHtml(meta)}</div>
        <div class="top-meta">${escapeHtml(l.address || "")}</div>
        <div class="top-meta"><span class="badge">${escapeHtml(l.site)}</span> ${escapeHtml((l.saved_at || "").slice(0, 10))}</div>
        ${flagChipsHtml(l)}
      </div>
    </div>`;
}

function renderFavorites() {
  const items = Object.values(favorites).sort((a, b) =>
    (b.saved_at || "").localeCompare(a.saved_at || "")
  );
  $("fav-list").innerHTML = items.length
    ? `<div class="fav-grid">${items.map(favCardHtml).join("")}</div>`
    : '<p class="status">Todavía no guardaste ningún aviso. Tocá el corazón en la pestaña Buscar o en el Top 5.</p>';
  if (favLoaded) setStatus($("fav-status"), `${items.length} guardados`);
}

$("reload-fav").addEventListener("click", () => loadFavorites().then(renderFavorites));

/* ---------- Señales de riesgo (auto del scraper + zonas y notas del usuario) ---------- */

let zones = {};
let zonesSha = null;
let userNotes = {};
let notesSha = null;
let riskLoaded = false;
let riskQueue = Promise.resolve();

function safeParse(s, dflt) {
  try { return JSON.parse(s); } catch { return dflt; }
}

async function loadRiskData() {
  try {
    const z = await fetchFile("data/zones.json");
    zonesSha = z.sha;
    zones = z.content ? safeParse(z.content, {}) : {};
    const n = await fetchFile("data/notes.json");
    notesSha = n.sha;
    userNotes = n.content ? safeParse(n.content, {}) : {};
  } catch {
    zones = {}; userNotes = {};
  }
  riskLoaded = true;
}

function normZone(s) {
  return (s || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function zoneFlag(l) {
  const hay = normZone(`${l.address} ${l.search_name} ${l.url}`);
  for (const [name, level] of Object.entries(zones)) {
    if (name && hay.includes(normZone(name))) {
      if (level === "alta") return { level: "high", label: `Zona marcada como inseguridad alta (${name})` };
      if (level === "media") return { level: "med", label: `Zona marcada como inseguridad media (${name})` };
      return { level: "low", label: `Zona marcada como tranquila (${name})` };
    }
  }
  return null;
}

function noteFlags(l) {
  const n = userNotes[l.id];
  if (!n) return [];
  if (n.level) return [{ level: n.level, label: n.note ? `Tu nota: ${n.note}` : "Marcada por vos" }];
  if (n.note) return [{ level: "low", label: `Tu nota: ${n.note}` }];
  return [];
}

// Combina las señales automáticas del scraper con la zona y las notas propias
function displayFlags(l) {
  const flags = [...(l.flags || [])];
  const z = zoneFlag(l);
  if (z) flags.push(z);
  flags.push(...noteFlags(l));
  return flags;
}

function riskLevelRank(l) {
  const levels = displayFlags(l).map((f) => f.level);
  if (levels.includes("high")) return 3;
  if (levels.includes("med")) return 2;
  if (levels.length) return 1;
  return 0;
}

function shortFlag(s) {
  return s.length > 46 ? s.slice(0, 44) + "…" : s;
}

function flagChipsHtml(l) {
  const flags = displayFlags(l);
  if (!flags.length) return "";
  const cls = { high: "flag-high", med: "flag-med", low: "flag-low", info: "flag-low" };
  return `<div class="flags-wrap">${flags.map((f) => {
    const ic = f.level === "high" || f.level === "med" ? "alert" : "info";
    return `<span class="flag ${cls[f.level] || "flag-low"}" title="${escapeHtml(f.label)}">${icon(ic, 12)} ${escapeHtml(shortFlag(f.label))}</span>`;
  }).join("")}</div>`;
}

function noteBtnHtml(l) {
  const has = Boolean(userNotes[l.id]);
  return `<button class="note-btn${has ? " has-note" : ""}" data-note="${escapeHtml(l.id)}" title="${has ? "Editar tu nota" : "Agregar una nota / marca"}">${icon("pencil", 15)}</button>`;
}

/* ---------- Mapa de inseguridad por comuna (datos oficiales GCBA) ---------- */

const COMUNA_BARRIOS = {
  1: ["retiro", "san nicolas", "puerto madero", "san telmo", "montserrat", "constitucion"],
  2: ["recoleta"],
  3: ["balvanera", "san cristobal"],
  4: ["la boca", "barracas", "parque patricios", "nueva pompeya"],
  5: ["almagro", "boedo"],
  6: ["caballito"],
  7: ["flores", "parque chacabuco"],
  8: ["villa soldati", "villa lugano", "villa riachuelo"],
  9: ["liniers", "mataderos", "parque avellaneda"],
  10: ["villa real", "monte castro", "versalles", "floresta", "velez sarsfield", "villa luro"],
  11: ["villa general mitre", "villa devoto", "villa del parque", "villa santa rita"],
  12: ["coghlan", "saavedra", "villa urquiza", "villa pueyrredon"],
  13: ["nunez", "belgrano", "colegiales"],
  14: ["palermo"],
  15: ["chacarita", "villa crespo", "la paternal", "villa ortuzar", "agronomia", "parque chas"],
};
const BARRIO_COMUNA = {};
for (const [c, bs] of Object.entries(COMUNA_BARRIOS)) bs.forEach((b) => (BARRIO_COMUNA[b] = Number(c)));

const LEVEL_INFO = {
  alto: { cls: "cm-alto", dot: "red", txt: "Inseguridad alta", flag: "flag-high" },
  medio: { cls: "cm-medio", dot: "yellow", txt: "Inseguridad media", flag: "flag-med" },
  bajo: { cls: "cm-bajo", dot: "green", txt: "Inseguridad baja", flag: "flag-low" },
};

let crimeData = null;
let comunasGeo = null;
let barriosGeo = null;
let crimeLoaded = false;
let mapMode = "comuna";

async function loadCrimeData() {
  if (crimeLoaded) return;
  try {
    const c = await fetchFile("data/crime.json");
    crimeData = c.content ? safeParse(c.content, null) : null;
    const g = await fetchFile("data/comunas.geojson");
    comunasGeo = g.content ? safeParse(g.content, null) : null;
    const b = await fetchFile("data/barrios.geojson");
    barriosGeo = b.content ? safeParse(b.content, null) : null;
  } catch { crimeData = null; comunasGeo = null; barriosGeo = null; }
  crimeLoaded = true;
}

function comunaFromZone(text) {
  const hay = normZone(text);
  for (const b of Object.keys(BARRIO_COMUNA).sort((a, z) => z.length - a.length)) {
    if (hay.includes(b)) return BARRIO_COMUNA[b];
  }
  const m = hay.match(/comuna\s*0?(\d{1,2})/);
  if (m) { const n = Number(m[1]); if (n >= 1 && n <= 15) return n; }
  return null;
}

function securityBadge(level, comuna) {
  const m = LEVEL_INFO[level] || LEVEL_INFO.medio;
  return `<span class="sec-badge"><span class="dot ${m.dot}"></span> Seguridad de la zona: ${m.txt}${comuna ? ` (Comuna ${comuna})` : ""}</span>`;
}

function updateZoneSecurity() {
  const el = $("zone-security");
  if (!el) return;
  if (!isMenuMode()) { el.innerHTML = ""; return; }
  const comuna = comunaFromZone($("f-zone").value);
  if (comuna == null) { el.innerHTML = ""; return; }
  if (!crimeData) { loadCrimeData().then(updateZoneSecurity); el.innerHTML = ""; return; }
  const info = crimeData.comunas[String(comuna)];
  el.innerHTML = info
    ? securityBadge(info.level, comuna)
    : `<span class="sec-badge">Comuna ${comuna} — sin datos de delito</span>`;
}

// Proyección simple lon/lat -> plano (CABA es chica; corrijo la latitud).
// `mode` decide qué capa dibujar: comunas (por 100k) o barrios (por total).
function buildMapSvg(mode) {
  const geo = mode === "barrio" ? barriosGeo : comunasGeo;
  const cos = Math.cos((-34.61 * Math.PI) / 180);
  const proj = (lon, lat) => [lon * cos, -lat];
  const polysOf = (geom) => (geom.type === "MultiPolygon" ? geom.coordinates : [geom.coordinates]);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  geo.features.forEach((f) =>
    polysOf(f.geometry).forEach((poly) => poly.forEach((ring) => ring.forEach(([lon, lat]) => {
      const [x, y] = proj(lon, lat);
      if (x < minX) minX = x; if (y < minY) minY = y; if (x > maxX) maxX = x; if (y > maxY) maxY = y;
    })))
  );
  const W = 560, pad = 6, scale = (W - 2 * pad) / (maxX - minX);
  const H = (maxY - minY) * scale + 2 * pad;
  const tx = (x) => (x - minX) * scale + pad;
  const ty = (y) => (y - minY) * scale + pad;

  const paths = geo.features.map((f) => {
    let d = "";
    polysOf(f.geometry).forEach((poly) => poly.forEach((ring) => {
      ring.forEach(([lon, lat], i) => { const [x, y] = proj(lon, lat); d += `${i ? "L" : "M"}${tx(x).toFixed(1)} ${ty(y).toFixed(1)} `; });
      d += "Z ";
    }));
    if (mode === "barrio") {
      const b = f.properties.barrio;
      const info = (crimeData.barrios || {})[b];
      const cls = (LEVEL_INFO[(info || {}).level] || {}).cls || "cm-na";
      return `<path class="comuna ${cls}" data-barrio="${escapeHtml(b)}" d="${d.trim()}"><title>${escapeHtml(b.replace(/\b\w/g, (c) => c.toUpperCase()))}</title></path>`;
    }
    const n = f.properties.comuna;
    const cls = (LEVEL_INFO[(crimeData.comunas[String(n)] || {}).level] || {}).cls || "cm-na";
    return `<path class="comuna ${cls}" data-comuna="${n}" d="${d.trim()}"><title>Comuna ${n}</title></path>`;
  }).join("");

  // Etiquetas: número de comuna (legibles); en barrios el mapa es denso, sin texto.
  const labels = mode === "barrio" ? "" : geo.features.map((f) => {
    const n = f.properties.comuna;
    let sx = 0, sy = 0, cnt = 0;
    polysOf(f.geometry).forEach((poly) => poly[0].forEach(([lon, lat]) => { const [x, y] = proj(lon, lat); sx += tx(x); sy += ty(y); cnt++; }));
    return `<text class="cm-label" x="${(sx / cnt).toFixed(0)}" y="${(sy / cnt).toFixed(0)}">${n}</text>`;
  }).join("");

  return `<svg viewBox="0 0 ${W} ${H.toFixed(0)}" class="crime-svg" role="img" aria-label="Mapa de inseguridad de CABA">${paths}${labels}</svg>`;
}

function renderCrimeMap() {
  if (!$("crime-map")) return;
  if (!crimeData || !comunasGeo) {
    $("crime-map").innerHTML = '<p class="status">La base de delitos todavía no se generó. Corré el workflow "Actualizar base de delitos" en GitHub Actions.</p>';
    return;
  }
  const barrioReady = mapMode === "barrio" && barriosGeo && crimeData.barrios;
  const effMode = mapMode === "barrio" && !barrioReady ? "comuna" : mapMode;
  $("crime-meta").textContent = effMode === "barrio"
    ? `Total de delitos registrados por barrio (terciles) · datos oficiales GCBA · años ${crimeData.years.join(", ")}`
    : `Delitos por 100.000 habitantes · datos oficiales GCBA (Mapa del Delito) · años ${crimeData.years.join(", ")}`;
  $("crime-map").innerHTML = buildMapSvg(effMode);
  showComunaDetail(null);
}

// Regresión lineal simple sobre los años -> proyección del año siguiente.
function projectNextYear(years, values) {
  const n = years.length;
  if (n < 2) return null;
  const xs = years.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = values.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0;
  xs.forEach((x, i) => { num += (x - mx) * (values[i] - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0;
  const intercept = my - slope * mx;
  const pred = Math.max(0, Math.round(slope * n + intercept));
  return { year: years[n - 1] + 1, value: pred, slope };
}

// Mini-gráfico de líneas de la evolución por año + punto proyectado (punteado).
function trendChartHtml(byYear, title) {
  const years = Object.keys(byYear).map(Number).sort((a, b) => a - b);
  if (years.length < 2) return "";
  const values = years.map((y) => byYear[String(y)] || 0);
  const proj = projectNextYear(years, values);
  const allY = [...years, proj ? proj.year : years[years.length - 1]];
  const allV = [...values, proj ? proj.value : values[values.length - 1]];
  const W = 300, H = 110, padL = 6, padR = 6, padT = 14, padB = 20;
  const maxV = Math.max(...allV), minV = Math.min(...allV);
  const range = maxV - minV || 1;
  const span = allY.length - 1;
  const px = (i) => padL + (i * (W - padL - padR)) / span;
  const py = (v) => padT + (1 - (v - minV) / range) * (H - padT - padB);

  const realPts = values.map((v, i) => [px(i), py(v)]);
  const line = realPts.map(([x, y], i) => `${i ? "L" : "M"}${x.toFixed(1)} ${y.toFixed(1)}`).join(" ");
  const dots = realPts.map(([x, y]) => `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.5" class="tc-dot"/>`).join("");
  const xlabels = years.map((y, i) => `<text class="tc-x" x="${px(i).toFixed(1)}" y="${H - 6}">${String(y).slice(2)}</text>`).join("");

  let projSvg = "", projText = "";
  if (proj) {
    const [lx, ly] = realPts[realPts.length - 1];
    const pxp = px(allY.length - 1), pyp = py(proj.value);
    projSvg = `<path d="M${lx.toFixed(1)} ${ly.toFixed(1)} L${pxp.toFixed(1)} ${pyp.toFixed(1)}" class="tc-proj-line"/>` +
      `<circle cx="${pxp.toFixed(1)}" cy="${pyp.toFixed(1)}" r="2.8" class="tc-proj-dot"/>` +
      `<text class="tc-x tc-proj-x" x="${pxp.toFixed(1)}" y="${H - 6}">${String(proj.year).slice(2)}*</text>`;
    const first = values[0], last = values[values.length - 1];
    const pct = first ? Math.round((100 * (last - first)) / first) : 0;
    const dir = pct > 3 ? `subió ${pct}%` : pct < -3 ? `bajó ${Math.abs(pct)}%` : "se mantuvo";
    projText = `<p class="tc-note">${escapeHtml(dir)} entre ${years[0]} y ${years[years.length - 1]}. ` +
      `Proyección ${proj.year}: <strong class="tabnum">~${proj.value.toLocaleString("es-AR")}</strong> ` +
      `<span class="tc-star">(*estimado)</span></p>`;
  }
  return `<div class="trend">
    <div class="cd-sub">${escapeHtml(title)}</div>
    <svg viewBox="0 0 ${W} ${H}" class="trend-svg" role="img" aria-label="Evolución de delitos por año">
      <path d="${line}" class="tc-line"/>${projSvg}${dots}${xlabels}
    </svg>${projText}
  </div>`;
}

function byTypeBarsHtml(byType) {
  const maxV = Math.max(...Object.values(byType || {}), 1);
  return Object.entries(byType || {}).map(([t, v]) =>
    `<div class="ctype"><span class="ctype-name">${escapeHtml(t)}</span><span class="ctype-bar"><span style="width:${Math.round(100 * v / maxV)}%"></span></span><span class="ctype-val tabnum">${v.toLocaleString("es-AR")}</span></div>`
  ).join("");
}

// Detalle de una comuna (n numérico) o de un barrio (string).
function showComunaDetail(key) {
  const box = $("comuna-detail");
  if (!box) return;
  if (key == null) {
    box.innerHTML = `<p class="status">Tocá ${mapMode === "barrio" ? "un barrio" : "una comuna"} en el mapa para ver el detalle de delitos y su evolución por año.</p>`;
    return;
  }
  if (typeof key === "string") { showBarrioDetail(key); return; }
  const n = key;
  const info = crimeData.comunas[String(n)];
  if (!info) { box.innerHTML = ""; return; }
  const m = LEVEL_INFO[info.level] || LEVEL_INFO.medio;
  const barrios = (COMUNA_BARRIOS[n] || []).map((b) => b.replace(/\b\w/g, (c) => c.toUpperCase())).join(", ");
  box.innerHTML = `
    <div class="cd-head"><span class="flag ${m.flag}">${m.txt}</span> <strong>Comuna ${n}</strong></div>
    <div class="top-meta">${escapeHtml(barrios)}</div>
    <div class="cd-stat"><span class="tabnum">${info.per100k.toLocaleString("es-AR")}</span> delitos / 100.000 hab · <span class="tabnum">${info.total.toLocaleString("es-AR")}</span> registrados</div>
    <div class="ctypes">${byTypeBarsHtml(info.by_type)}</div>
    ${info.by_year ? trendChartHtml(info.by_year, "Evolución por año") : ""}`;
}

function showBarrioDetail(b) {
  const box = $("comuna-detail");
  const info = (crimeData.barrios || {})[b];
  const nice = b.replace(/\b\w/g, (c) => c.toUpperCase());
  if (!info) {
    box.innerHTML = `<div class="cd-head"><span class="flag flag-na">Sin datos</span> <strong>${escapeHtml(nice)}</strong></div>
      <p class="status">No hay registros de delito para este barrio en la base oficial.</p>`;
    return;
  }
  const m = LEVEL_INFO[info.level] || LEVEL_INFO.medio;
  const comuna = info.comuna;
  const cinfo = comuna != null ? crimeData.comunas[String(comuna)] : null;
  box.innerHTML = `
    <div class="cd-head"><span class="flag ${m.flag}">${m.txt}</span> <strong>${escapeHtml(nice)}</strong></div>
    <div class="top-meta">Comuna ${comuna}</div>
    <div class="cd-stat"><span class="tabnum">${info.total.toLocaleString("es-AR")}</span> delitos registrados (${crimeData.years.join("–")})</div>
    <div class="ctypes">${byTypeBarsHtml(info.by_type)}</div>
    ${cinfo && cinfo.by_year ? trendChartHtml(cinfo.by_year, `Evolución de la Comuna ${comuna}`) : ""}`;
}

function thumbHtml(l) {
  const imgs = (l.images && l.images.length ? l.images : [l.image]).filter(Boolean);
  if (!imgs.length) return noImgHtml("thumb noimg");
  // miniatura que va rotando todas las fotos; click = popup con galería
  return `
    <div class="pcar thumb-pcar" data-images='${escapeHtml(JSON.stringify(imgs))}' data-idx="0" title="Click para ver las fotos">
      <img class="pcar-img thumb zoomable" src="${escapeHtml(imgs[0])}" loading="lazy" alt="" onerror="imgFail(this)">
      ${imgs.length > 1 ? `<span class="pcar-count">1/${imgs.length}</span>` : ""}
    </div>`;
}

function renderResults(listings) {
  if (!listings.length) {
    $("results-list").innerHTML =
      '<p class="status">Ningún aviso coincide con los filtros. Probá aflojar alguno o tocá "Limpiar filtros".</p>';
    return;
  }
  const rows = listings.map((l) => `
    <tr>
      <td>${thumbHtml(l)}</td>
      <td class="tabnum">${escapeHtml((l.first_seen || "").slice(0, 16).replace("T", " "))}</td>
      <td><span class="badge">${escapeHtml(l.site)}</span></td>
      <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a><br>
          <small>${escapeHtml(l.address || "")}</small>
          ${flagChipsHtml(l)}</td>
      <td>${fmtPrice(l)}</td>
      <td>${l.rooms ?? "-"} amb / ${l.surface_m2 ? l.surface_m2 + " m²" : "-"}</td>
      <td><small>${escapeHtml(l.search_name || "")}</small></td>
      <td><div class="row" style="gap:2px;margin:0">${noteBtnHtml(l)}${heartHtml(l)}</div></td>
    </tr>`).join("");
  $("results-list").innerHTML = `
    <table>
      <thead><tr><th>Foto</th><th>Visto</th><th>Portal</th><th>Aviso y señales</th><th>Precio</th><th>Amb/m²</th><th>Job</th><th></th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

/* ---------- Top 5 por operación ---------- */

function jobOperation(searchName) {
  const job = (jobsDoc?.searches || []).find((s) => s.name === searchName);
  return job?.operation || "";
}

/* Avisos guardados antes de que existiera el campo 'operation' (o de jobs
 * renombrados): se infiere de la URL del aviso o del nombre del job. */
function inferOperation(l) {
  const hay = `${l.url || ""} ${l.search_name || ""}`.toLowerCase();
  if (/alquiler|alquilo|\/rent\b|rent\?|operationid=2/.test(hay)) return "alquiler";
  if (/venta|compra|\/buy\b|buy\?|operationid=1/.test(hay)) return "venta";
  return "";
}

function listingOperation(l) {
  return l.operation || jobOperation(l.search_name) || inferOperation(l);
}

/* ---------- Criterios configurables del Top 5 ---------- */

const TOP_PREFS_KEY = "resc_top_prefs";
const TOP_FIELDS = ["t-criteria", "t-currency", "t-max-price", "t-min-rooms", "t-min-surface", "t-with-photo"];

function loadTopPrefs() {
  try {
    const prefs = JSON.parse(localStorage.getItem(TOP_PREFS_KEY) || "{}");
    TOP_FIELDS.forEach((id) => { if (prefs[id] != null) $(id).value = prefs[id]; });
  } catch { /* prefs corruptas: defaults */ }
}

function saveTopPrefs() {
  const prefs = {};
  TOP_FIELDS.forEach((id) => (prefs[id] = $(id).value));
  localStorage.setItem(TOP_PREFS_KEY, JSON.stringify(prefs));
}

TOP_FIELDS.forEach((id) => $(id).addEventListener("change", () => { saveTopPrefs(); renderTop(); }));
document.querySelectorAll("#t-max-price, #t-min-rooms, #t-min-surface").forEach((el) =>
  el.addEventListener("input", () => { saveTopPrefs(); renderTop(); })
);

/* Ranking según los criterios del usuario. El precio solo se compara
 * entre avisos de la misma moneda. */
// El tipo no se guarda como campo: se infiere del título y la URL del aviso.
function guessPropertyType(l) {
  const hay = `${l.title || ""} ${l.url || ""}`.toLowerCase();
  if (/\bph\b|\/ph[-/]/.test(hay)) return "ph";
  if (/\bcasas?\b|chalet/.test(hay)) return "casa";
  if (/monoambiente|departamento|\bdepto\b|\bdto\b|\/departamento/.test(hay)) return "departamento";
  return null;
}

// Patio/jardín/parrilla en el título (única fuente que tenemos del aviso).
function hasOutdoor(l) {
  return /\bpatio\b|jard[ií]n|parrilla|quincho|\bfondo\b|terraza/.test((l.title || "").toLowerCase());
}

// Seguridad de la zona: MULTIPLICADOR del puntaje (no un sumando), porque
// "zona segura / barrio seguro" es un requisito, no un lindo-de-tener. Una
// villa o una comuna/barrio rojo hunden el puntaje por más lindo que sea.
function safetyMultiplier(l) {
  const flags = l.flags || [];
  if (flags.some((f) => f.type === "villa")) return 0.08;
  const c = flags.find((f) => f.type === "crime");
  if (c) return c.level === "high" ? 0.25 : c.level === "med" ? 0.7 : 1;
  return 0.9; // zona sin dato de delito: casi neutral
}

// Dormitorios: 3 es lo ideal. Una casa banca 2; PH y depto piden 3 sí o sí.
function bedroomsScore(l, type) {
  const b = l.bedrooms;
  if (b == null) return 0.4; // desconocido: ni premia ni castiga fuerte
  if (b >= 3) return 1;
  if (b === 2) return type === "casa" ? 0.75 : 0.25;
  return 0.1;
}

// Puntaje "para vivir" (0..1) según el criterio del usuario, por tipo de propiedad.
function livabilityParts(l, priceRanges, norm) {
  const type = guessPropertyType(l);
  const bed = bedroomsScore(l, type);
  const amb = l.rooms == null ? 0.4 : l.rooms >= 4 ? 1 : l.rooms === 3 ? 0.7 : l.rooms === 2 ? 0.4 : 0.15;
  const depto = type === "departamento";
  const outdoor = hasOutdoor(l) ? 1 : 0.4;
  const pr = priceRanges[l.price_currency || "?"];
  const priceScore = pr && l.price_amount != null ? 1 - norm(l.price_amount, pr[0], pr[1]) : 0.5;
  // Calidad del inmueble: dormitorios manda, después ambientes; patio solo casa/PH.
  const w = depto
    ? { bed: 0.48, amb: 0.32, out: 0, price: 0.20 }
    : { bed: 0.40, amb: 0.25, out: 0.15, price: 0.20 };
  const quality = w.bed * bed + w.amb * amb + w.out * outdoor + w.price * priceScore;
  // La seguridad multiplica: una zona insegura hunde el puntaje entero.
  const score = quality * safetyMultiplier(l);
  return { type, score };
}

function computeTop(operation, count = 5) {
  const criteria = $("t-criteria").value;
  const curFilter = $("t-currency").value;
  const maxPrice = $("t-max-price").value.trim() === "" ? null : Number($("t-max-price").value);
  const minRooms = $("t-min-rooms").value.trim() === "" ? null : Number($("t-min-rooms").value);
  const minSurf = $("t-min-surface").value.trim() === "" ? null : Number($("t-min-surface").value);
  const withPhoto = $("t-with-photo").value === "yes";

  const group = allListings.filter((l) => {
    if (listingOperation(l) !== operation) return false;
    if (l.price_amount == null && criteria !== "recent") return false;
    if (curFilter && l.price_currency !== curFilter) return false;
    if (maxPrice != null && !(l.price_amount != null && l.price_amount <= maxPrice)) return false;
    if (minRooms != null && !(l.rooms != null && l.rooms >= minRooms)) return false;
    if (minSurf != null && !(l.surface_m2 != null && l.surface_m2 >= minSurf)) return false;
    if (withPhoto && !l.image) return false;
    return true;
  });
  if (!group.length) return [];

  const range = (values) => [Math.min(...values), Math.max(...values)];
  const norm = (v, min, max) => (max > min ? (v - min) / (max - min) : 0.5);

  let scored;
  if (criteria === "price") {
    scored = group.map((l) => ({ l, score: null, detail: fmtPrice(l) }));
    scored.sort((a, b) => (a.l.price_amount ?? Infinity) - (b.l.price_amount ?? Infinity));
  } else if (criteria === "ppm2") {
    scored = group
      .filter((l) => pricePerM2(l) != null)
      .map((l) => ({ l, score: null, detail: `${Math.round(pricePerM2(l)).toLocaleString("es-AR")}/m²` }));
    scored.sort((a, b) => pricePerM2(a.l) - pricePerM2(b.l));
  } else if (criteria === "surface") {
    scored = group
      .filter((l) => l.surface_m2)
      .map((l) => ({ l, score: null, detail: `${Math.round(l.surface_m2)} m²` }));
    scored.sort((a, b) => b.l.surface_m2 - a.l.surface_m2);
  } else if (criteria === "recent") {
    scored = group.map((l) => ({ l, score: null, detail: (l.first_seen || "").slice(0, 10) }));
    scored.sort((a, b) => (b.l.first_seen || "").localeCompare(a.l.first_seen || ""));
  } else if (criteria === "livable") {
    // "Para vivir": dormitorios (3, casa banca 2), 4+ ambientes, patio en
    // casa/PH, y zona/barrio seguros. Ver livabilityParts().
    const byCurrency = {};
    for (const l of group) if (l.price_amount != null) (byCurrency[l.price_currency || "?"] ||= []).push(l.price_amount);
    const priceRanges = Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, range(v)]));
    scored = group.map((l) => {
      const { score } = livabilityParts(l, priceRanges, norm);
      return { l, score, detail: `ideal ${Math.round(score * 100)}%` };
    });
    scored.sort((a, b) => b.score - a.score || (b.l.first_seen || "").localeCompare(a.l.first_seen || ""));
  } else {
    // balanceado
    const byCurrency = {};
    for (const l of group) (byCurrency[l.price_currency || "?"] ||= []).push(l.price_amount);
    const priceRanges = Object.fromEntries(Object.entries(byCurrency).map(([c, v]) => [c, range(v)]));
    const surfs = group.filter((l) => l.surface_m2).map((l) => l.surface_m2);
    const [smin, smax] = surfs.length ? range(surfs) : [0, 0];
    const roomVals = group.filter((l) => l.rooms).map((l) => l.rooms);
    const [rmin, rmax] = roomVals.length ? range(roomVals) : [0, 0];
    scored = group.map((l) => {
      const [pmin, pmax] = priceRanges[l.price_currency || "?"];
      const priceScore = 1 - norm(l.price_amount, pmin, pmax);
      const surfScore = l.surface_m2 ? norm(l.surface_m2, smin, smax) : 0.4;
      const roomScore = l.rooms ? norm(l.rooms, rmin, rmax) : 0.4;
      const score = 0.5 * priceScore + 0.3 * surfScore + 0.2 * roomScore;
      return { l, score, detail: `match ${Math.round(score * 100)}%` };
    });
    scored.sort((a, b) => b.score - a.score || (b.l.first_seen || "").localeCompare(a.l.first_seen || ""));
  }
  return scored.slice(0, count);
}

/* Mini-carrusel de fotos DE LA PROPIEDAD: flechas, contador y auto-avance */
function photoCarouselHtml(l, extra = "") {
  const imgs = (l.images && l.images.length ? l.images : [l.image]).filter(Boolean);
  if (!imgs.length) return `${noImgHtml("noimg")}${extra}`;
  const multi = imgs.length > 1;
  return `
    <div class="pcar" data-images='${escapeHtml(JSON.stringify(imgs))}' data-idx="0">
      <img class="pcar-img zoomable" src="${escapeHtml(imgs[0])}" loading="lazy" alt="" onerror="imgFail(this)">
      ${multi ? `
        <button type="button" class="pcar-nav prev" data-nav="-1" title="Foto anterior">${icon("chevron-left", 16)}</button>
        <button type="button" class="pcar-nav next" data-nav="1" title="Foto siguiente">${icon("chevron-right", 16)}</button>
        <span class="pcar-count">1/${imgs.length}</span>` : ""}
      ${extra}
    </div>`;
}

function stepCarousel(pcar, delta) {
  try {
    const imgs = JSON.parse(pcar.dataset.images);
    const idx = (Number(pcar.dataset.idx || 0) + delta + imgs.length) % imgs.length;
    pcar.dataset.idx = idx;
    pcar.querySelector(".pcar-img").src = imgs[idx];
    const count = pcar.querySelector(".pcar-count");
    if (count) count.textContent = `${idx + 1}/${imgs.length}`;
  } catch { /* data corrupta: se ignora */ }
}

document.body.addEventListener("click", (e) => {
  const nav = e.target.closest(".pcar-nav");
  if (!nav) return;
  e.preventDefault();
  e.stopPropagation();
  const pcar = nav.closest(".pcar");
  pcar.dataset.manual = "1"; // el auto-avance no pisa la navegación manual
  stepCarousel(pcar, Number(nav.dataset.nav));
});

let cyclingTimer = null;
function startImageCycling() {
  if (cyclingTimer) clearInterval(cyclingTimer);
  if (prefersReducedMotion) return; // respetá prefers-reduced-motion: sin auto-avance
  cyclingTimer = setInterval(() => {
    document.querySelectorAll(".pcar[data-images]").forEach((pcar) => {
      if (pcar.dataset.manual) return;
      if (JSON.parse(pcar.dataset.images || "[]").length > 1) stepCarousel(pcar, 1);
    });
  }, 3000);
}

function topCardHtml({ l, detail }, rank) {
  const meta = [
    PTYPE_LABEL[guessPropertyType(l)] || null,
    l.bedrooms != null ? `${l.bedrooms} dorm` : null,
    l.rooms ? `${l.rooms} amb` : null,
    hasOutdoor(l) ? "patio/jardín" : null,
    l.surface_m2 ? `${Math.round(l.surface_m2)} m²` : null,
    pricePerM2(l) ? `${Math.round(pricePerM2(l)).toLocaleString("es-AR")}/m²` : null,
  ].filter(Boolean).join(" · ");
  const thumbExtras = `<span class="top-rank">#${rank}</span><span class="thumb-fav">${heartHtml(l)}</span>`;
  return `
    <div class="top-card">
      <div class="top-thumb">${photoCarouselHtml(l, thumbExtras)}</div>
      <div class="top-body">
        <div class="top-price">${fmtPrice(l)} <span class="badge">${escapeHtml(detail || "")}</span></div>
        <a class="top-title" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a>
        <div class="top-meta">${escapeHtml(meta)}</div>
        <div class="top-meta">${escapeHtml(l.address || "")}</div>
        <div class="top-meta"><span class="badge">${escapeHtml(l.site)}</span> ${escapeHtml(l.search_name || "")}</div>
        ${flagChipsHtml(l)}
      </div>
    </div>`;
}

function renderTopGroup(operation, container) {
  const top = computeTop(operation);
  if (!top.length) {
    container.innerHTML = `<p class="status">No hay avisos de ${operation === "venta" ? "venta" : "alquiler"} que cumplan tus criterios. Ajustá los filtros de arriba o activá un job de esa operación.</p>`;
    return;
  }
  container.innerHTML = `<div class="top-grid">${top.map((item, i) => topCardHtml(item, i + 1)).join("")}</div>`;
}

function renderTop() {
  renderTopGroup("alquiler", $("top-rent"));
  renderTopGroup("venta", $("top-buy"));
  setStatus($("top-status"), `${allListings.length} avisos analizados`);
  startImageCycling();
}

$("reload-top").addEventListener("click", loadResults);

// Limpiar filtros del Top 5: vuelve al criterio "Para vivir" y saca topes.
$("top-clear").addEventListener("click", () => {
  $("t-criteria").value = "livable";
  $("t-currency").value = "";
  $("t-max-price").value = "";
  $("t-min-rooms").value = "";
  $("t-min-surface").value = "";
  $("t-with-photo").value = "";
  saveTopPrefs();
  renderTop();
});

/* ---------- Preview al pasar el mouse + Lightbox al hacer click ---------- */

const imgPreview = document.createElement("img");
imgPreview.id = "img-preview";
document.body.appendChild(imgPreview);

document.body.addEventListener("mouseover", (e) => {
  const img = e.target.closest("img.zoomable");
  if (!img || lightbox.classList.contains("show")) return;
  imgPreview.src = img.src;
  imgPreview.classList.add("show");
});
document.body.addEventListener("mousemove", (e) => {
  if (!imgPreview.classList.contains("show")) return;
  const margin = 20;
  const w = imgPreview.offsetWidth || 420;
  const h = imgPreview.offsetHeight || 300;
  let x = e.clientX + margin;
  let y = e.clientY + margin;
  if (x + w > window.innerWidth) x = e.clientX - w - margin;
  if (y + h > window.innerHeight) y = Math.max(8, window.innerHeight - h - margin);
  imgPreview.style.left = `${Math.max(8, x)}px`;
  imgPreview.style.top = `${y}px`;
});
document.body.addEventListener("mouseout", (e) => {
  if (e.target.closest && e.target.closest("img.zoomable")) {
    imgPreview.classList.remove("show");
  }
});

/* Lightbox: galería con anterior/siguiente, zoom y teclado */

const lightbox = document.createElement("div");
lightbox.id = "lightbox";
lightbox.innerHTML = `
  <button id="lb-close" title="Cerrar (Esc)">${icon("x", 20)}</button>
  <button id="lb-prev" title="Anterior (izquierda)">${icon("chevron-left", 26)}</button>
  <img id="lb-img" alt="" title="Click para hacer zoom">
  <button id="lb-next" title="Siguiente (derecha)">${icon("chevron-right", 26)}</button>
  <span id="lb-count"></span>`;
document.body.appendChild(lightbox);

let lbImages = [];
let lbIdx = 0;

function lbShow() {
  const img = $("lb-img");
  img.src = lbImages[lbIdx];
  img.classList.remove("zoomed");
  $("lb-count").textContent = `${lbIdx + 1} / ${lbImages.length}`;
  const multi = lbImages.length > 1;
  $("lb-prev").style.visibility = multi ? "visible" : "hidden";
  $("lb-next").style.visibility = multi ? "visible" : "hidden";
}

function openLightbox(images, idx = 0) {
  lbImages = images.filter(Boolean);
  if (!lbImages.length) return;
  lbIdx = Math.min(idx, lbImages.length - 1);
  imgPreview.classList.remove("show");
  lightbox.classList.add("show");
  lbShow();
}

function closeLightbox() {
  lightbox.classList.remove("show");
}

$("lb-close").addEventListener("click", closeLightbox);
$("lb-prev").addEventListener("click", (e) => { e.stopPropagation(); lbIdx = (lbIdx - 1 + lbImages.length) % lbImages.length; lbShow(); });
$("lb-next").addEventListener("click", (e) => { e.stopPropagation(); lbIdx = (lbIdx + 1) % lbImages.length; lbShow(); });
$("lb-img").addEventListener("click", (e) => { e.stopPropagation(); e.target.classList.toggle("zoomed"); });
lightbox.addEventListener("click", (e) => { if (e.target === lightbox) closeLightbox(); });

document.addEventListener("keydown", (e) => {
  if (!lightbox.classList.contains("show")) return;
  if (e.key === "Escape") closeLightbox();
  if (e.key === "ArrowLeft" && lbImages.length > 1) { lbIdx = (lbIdx - 1 + lbImages.length) % lbImages.length; lbShow(); }
  if (e.key === "ArrowRight" && lbImages.length > 1) { lbIdx = (lbIdx + 1) % lbImages.length; lbShow(); }
});

// Click en cualquier foto: abre la galería con TODAS las fotos del aviso
document.body.addEventListener("click", (e) => {
  const img = e.target.closest("img.zoomable");
  if (!img || e.target.closest(".pcar-nav") || img.id === "lb-img") return;
  const pcar = img.closest(".pcar");
  let images = [img.src];
  let idx = 0;
  if (pcar && pcar.dataset.images) {
    try {
      images = JSON.parse(pcar.dataset.images);
      idx = Number(pcar.dataset.idx || 0);
    } catch { /* usa la imagen sola */ }
  }
  openLightbox(images, idx);
});

$("reload-results").addEventListener("click", loadResults);

const SEARCH_TEXT_FIELDS = [
  "s-text", "s-text-exclude", "s-min-price", "s-max-price",
  "s-min-rooms", "s-max-rooms", "s-min-bedrooms", "s-min-bathrooms",
  "s-min-surface", "s-max-surface", "s-since",
];
const SEARCH_SELECT_FIELDS = [
  "s-site", "s-job", "s-operation", "s-currency",
  "s-require-price", "s-with-photo", "s-only-fav", "s-risk", "s-sort",
];
SEARCH_TEXT_FIELDS.forEach((id) => $(id).addEventListener("input", applySearch));
SEARCH_SELECT_FIELDS.forEach((id) => $(id).addEventListener("change", applySearch));

$("search-clear").addEventListener("click", () => {
  SEARCH_TEXT_FIELDS.forEach((id) => ($(id).value = ""));
  SEARCH_SELECT_FIELDS.forEach((id) => ($(id).value = id === "s-sort" ? "recent" : ""));
  applySearch();
});

/* ---------- Corridas ---------- */

const RUN_ICONS = {
  success: { ic: "check-circle", cls: "run-ic-ok" },
  failure: { ic: "x-circle", cls: "run-ic-bad" },
  cancelled: { ic: "circle", cls: "run-ic-muted" },
  in_progress: { ic: "loader", cls: "run-ic-muted" },
  queued: { ic: "hourglass", cls: "run-ic-muted" },
};
function runIconHtml(r) {
  const m = RUN_ICONS[r.conclusion || r.status] || { ic: "circle", cls: "run-ic-muted" };
  return `<span class="run-ic ${m.cls}">${icon(m.ic, 16)}</span>`;
}

let runsCache = [];

async function loadRunHistory() {
  try {
    const resp = await gh(`/contents/data/run_history.json?ref=${BRANCH}`, {
      headers: { Accept: "application/vnd.github.raw+json" },
    });
    if (resp.status === 404) return [];
    const data = await resp.json();
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

/* Busca la entrada del historial cuyo fin cae dentro de la ventana del run */
function historyForRun(run, history) {
  const from = run.run_started_at || run.created_at;
  const to = new Date(new Date(run.updated_at).getTime() + 2 * 60000)
    .toISOString().slice(0, 19) + "Z";
  return history.find((h) => h.finished_at >= from && h.finished_at <= to) || null;
}

function runStatsHtml(run, history) {
  if ((run.conclusion || run.status) === "failure") {
    return '<span class="badge run-bad">falló — ver log</span>';
  }
  const h = historyForRun(run, history);
  if (!h) return '<span class="badge">— sin actividad (0 jobs activos o prueba)</span>';
  const parts = [
    `<span class="badge run-ok">${icon("sparkles", 13)} ${h.new} nuevos</span>`,
    `<span class="badge">${icon("list", 13)} ${h.found} encontrados</span>`,
  ];
  if (h.only_job) parts.push(`<span class="badge">solo: ${escapeHtml(h.only_job)}</span>`);
  if (h.errors && h.errors.length) {
    parts.push(`<span class="badge run-warn" title="${escapeHtml(h.errors.join(" | "))}">${icon("alert", 13)} ${h.errors.length} avisos de error</span>`);
  }
  return parts.join(" ");
}

let runsHistory = [];
let runsPage = 1;
let selectMode = false;
const selectedRuns = new Set();
const RUNS_PER_PAGE = 30;

function runHasData(r) {
  const h = historyForRun(r, runsHistory);
  return !(Boolean(h) && !(h.new > 0)); // desconocido o >0 nuevos = puede tener datos
}

function runRowHtml(r) {
  const when = new Date(r.created_at).toLocaleString("es-AR");
  const h = historyForRun(r, runsHistory);
  const knownEmpty = Boolean(h) && !(h.new > 0);
  const delTitle = knownEmpty
    ? "Esta corrida no guardó avisos nuevos: no hay datos para borrar"
    : h ? `Borra del histórico los ${h.new} avisos que guardó esta corrida`
        : "Borra del histórico los avisos que guardó esta corrida";
  const check = selectMode
    ? `<label class="run-check"><input type="checkbox" data-sel="${r.id}" ${selectedRuns.has(String(r.id)) ? "checked" : ""}></label>`
    : "";
  return `<div class="run-row" data-row-run="${r.id}">
      <span class="run-main">${check}${runIconHtml(r)} <strong class="tabnum">#${r.run_number}</strong> · ${escapeHtml(r.event)} · <span class="tabnum">${when}</span><br>
        <span class="run-stats">${runStatsHtml(r, runsHistory)}</span>
      </span>
      <span class="row">
        <a href="${r.html_url}" target="_blank" rel="noopener">ver log ${icon("arrow-right", 13)}</a>
        <button class="btn small danger" data-run="${r.id}" ${knownEmpty ? "disabled" : ""} title="${escapeHtml(delTitle)}">${icon("trash")} Borrar datos</button>
        <button class="btn small" data-del-run="${r.id}" title="Elimina esta corrida de la lista (no toca los avisos guardados)">${icon("list-x")} Borrar corrida</button>
      </span>
    </div>`;
}

function renderRuns() {
  $("runs-list").innerHTML = runsCache.length
    ? runsCache.map(runRowHtml).join("")
    : '<p class="status">Sin corridas todavía.</p>';
  $("runs-list").classList.toggle("selecting", selectMode);
  setStatus($("runs-status"), `${runsCache.length} corridas cargadas`);
}

async function loadRuns(page = 1, append = false) {
  setStatus($("runs-status"), "Cargando corridas...");
  try {
    const [resp, history] = await Promise.all([
      gh(`/actions/workflows/scraper.yml/runs?per_page=${RUNS_PER_PAGE}&page=${page}`),
      page === 1 ? loadRunHistory() : Promise.resolve(runsHistory),
    ]);
    runsHistory = history;
    const data = await resp.json();
    const batch = (data.workflow_runs || []);
    runsPage = page;
    const merged = append ? runsCache.concat(batch) : batch;
    // dedup + más nuevas arriba
    const seen = new Set();
    runsCache = merged.filter((r) => (seen.has(r.id) ? false : seen.add(r.id)))
      .sort((a, b) => (b.created_at || "").localeCompare(a.created_at || ""));
    renderRuns();
    $("runs-more").classList.toggle("hidden", batch.length < RUNS_PER_PAGE);
  } catch (err) {
    setStatus($("runs-status"), "" + err.message, "error");
  }
}

$("reload-runs").addEventListener("click", () => { selectedRuns.clear(); loadRuns(1, false); });
$("runs-more").addEventListener("click", () => loadRuns(runsPage + 1, true));

/* ---------- Selección múltiple de corridas ---------- */

function updateSelCount() {
  const n = selectedRuns.size;
  $("runs-sel-count").textContent = `${n} seleccionada${n === 1 ? "" : "s"}`;
  $("bulk-del-runs").disabled = n === 0;
  // Borrar datos solo si alguna seleccionada podría tener datos
  const anyData = [...selectedRuns].some((id) => {
    const r = runsCache.find((x) => String(x.id) === id);
    return r && runHasData(r);
  });
  $("bulk-del-data").disabled = n === 0 || !anyData;
}

$("select-runs").addEventListener("click", () => {
  selectMode = !selectMode;
  if (!selectMode) selectedRuns.clear();
  $("runs-bulk").classList.toggle("hidden", !selectMode);
  $("select-runs").classList.toggle("primary", selectMode);
  renderRuns();
  updateSelCount();
});
$("bulk-cancel").addEventListener("click", () => {
  selectMode = false; selectedRuns.clear();
  $("runs-bulk").classList.add("hidden");
  $("select-runs").classList.remove("primary");
  renderRuns();
});
$("runs-list").addEventListener("change", (e) => {
  const cb = e.target.closest("input[data-sel]");
  if (!cb) return;
  if (cb.checked) selectedRuns.add(cb.dataset.sel);
  else selectedRuns.delete(cb.dataset.sel);
  updateSelCount();
});
$("runs-check-all").addEventListener("change", (e) => {
  selectedRuns.clear();
  if (e.target.checked) runsCache.forEach((r) => selectedRuns.add(String(r.id)));
  renderRuns();
  updateSelCount();
});

$("bulk-del-runs").addEventListener("click", async () => {
  const ids = [...selectedRuns];
  if (!ids.length || !confirm(`¿Eliminar ${ids.length} corridas de la lista? Los avisos guardados NO se tocan.`)) return;
  let ok = 0, lastErr = null;
  for (let i = 0; i < ids.length; i++) {
    const id = ids[i];
    setStatus($("runs-status"), `Borrando corridas... ${i + 1}/${ids.length}`);
    try {
      const resp = await gh(`/actions/runs/${id}`, { method: "DELETE" });
      if (resp.status === 204) {
        ok++;
        document.querySelector(`.run-row[data-row-run="${id}"]`)?.remove();
        runsCache = runsCache.filter((r) => String(r.id) !== id);
        selectedRuns.delete(id);
      } else {
        lastErr = `status ${resp.status}`;
      }
    } catch (err) {
      lastErr = err.message;
      // 403 = falta de permiso o rate limit; no tiene sentido seguir martillando
      if (/\b403\b/.test(err.message)) break;
    }
    // pausita para no gatillar el secondary rate limit de GitHub
    if (i < ids.length - 1) await new Promise((r) => setTimeout(r, 120));
  }
  updateSelCount();
  if (!lastErr) {
    setStatus($("runs-status"), `${ok} corridas eliminadas`, "ok");
  } else {
    setStatus($("runs-status"), deleteErrorHint(ok, ids.length, lastErr), "error");
  }
});

// Mensaje claro cuando el borrado de corridas falla (distingue permiso vs rate limit).
function deleteErrorHint(ok, total, err) {
  let hint = "";
  if (/\b403\b/.test(err)) {
    hint = /rate limit|secondary/i.test(err)
      ? " — GitHub frenó por rate limit; esperá un minuto y reintentá con menos corridas."
      : " — al token le falta el permiso 'Actions: Read and write'. Regeneralo en GitHub con ese permiso y volvé a conectar.";
  }
  return `${ok}/${total} corridas eliminadas. Error: ${err}${hint}`;
}

$("bulk-del-data").addEventListener("click", async () => {
  const runs = [...selectedRuns].map((id) => runsCache.find((r) => String(r.id) === id)).filter(Boolean);
  if (!runs.length || !confirm(`¿Borrar del histórico los avisos guardados por ${runs.length} corridas seleccionadas? Tus favoritos no se tocan.`)) return;
  setStatus($("runs-status"), "Borrando datos...");
  try {
    const { content, sha } = await fetchFile("data/listings.json");
    if (!content) { setStatus($("runs-status"), "No hay datos guardados"); return; }
    const listings = JSON.parse(content);
    const before = Object.keys(listings).length;
    for (const run of runs) {
      const from = run.run_started_at || run.created_at;
      const to = new Date(new Date(run.updated_at).getTime() + 2 * 60000).toISOString().slice(0, 19) + "Z";
      for (const [key, item] of Object.entries(listings)) {
        const seen = item.first_seen || "";
        if (seen >= from && seen <= to) delete listings[key];
      }
    }
    const removed = before - Object.keys(listings).length;
    if (!removed) { setStatus($("runs-status"), "Las corridas seleccionadas no guardaron avisos"); return; }
    await putFile("data/listings.json", JSON.stringify(listings, null, 2) + "\n", sha,
      `chore: borrar ${removed} avisos de ${runs.length} corridas desde la web`);
    allListings = Object.values(listings);
    populateSearchSelects(); applySearch(); renderTop();
    setStatus($("runs-status"), `${removed} avisos borrados del histórico`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "" + err.message, "error");
  }
});

/* Borrar del histórico los avisos guardados por una corrida.
 * Los avisos no guardan el id de la corrida, pero sí `first_seen` (UTC),
 * que siempre cae dentro de la ventana de ejecución del run: se eliminan
 * los avisos vistos por primera vez entre el inicio y el fin del run
 * (+2 minutos de margen). */
function setRowStats(runId, html) {
  const row = document.querySelector(`.run-row[data-row-run="${runId}"] .run-stats`);
  if (row) row.innerHTML = html;
}

/* Elimina el registro de la corrida de la lista de GitHub Actions
 * (no toca los avisos guardados). */
async function deleteRunRecord(run) {
  if (!confirm(
    `¿Eliminar la corrida #${run.run_number} de la lista?\n` +
    `Se borra el registro y su log en GitHub; los avisos guardados NO se tocan.`
  )) return;
  try {
    const resp = await gh(`/actions/runs/${run.id}`, { method: "DELETE" });
    if (resp.status !== 204) throw new Error(`status ${resp.status}`);
    document.querySelector(`.run-row[data-row-run="${run.id}"]`)?.remove();
    setStatus($("runs-status"), `Corrida #${run.run_number} eliminada de la lista`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "" + err.message, "error");
    alert(`No pude eliminar la corrida #${run.run_number}: ${err.message}`);
  }
}

$("runs-list").addEventListener("click", async (e) => {
  const delRunBtn = e.target.closest("button[data-del-run]");
  if (delRunBtn) {
    const run = runsCache.find((r) => String(r.id) === delRunBtn.dataset.delRun);
    if (run) deleteRunRecord(run);
    return;
  }
  const btn = e.target.closest("button[data-run]");
  if (!btn) return;
  const run = runsCache.find((r) => String(r.id) === btn.dataset.run);
  if (!run) return;
  if (!confirm(
    `¿Borrar del histórico los avisos que guardó la corrida #${run.run_number}?\n` +
    `El cambio se commitea en el repo y esos avisos desaparecen de la pestaña Buscar ` +
    `(si siguen publicados, una corrida futura puede volver a encontrarlos).`
  )) return;

  setStatus($("runs-status"), `Borrando datos de la corrida #${run.run_number}...`);
  btn.disabled = true;
  try {
    const { content, sha } = await fetchFile("data/listings.json");
    if (!content) {
      setStatus($("runs-status"), "No hay datos guardados todavía");
      return;
    }
    const listings = JSON.parse(content);
    const from = run.run_started_at || run.created_at;
    const to = new Date(new Date(run.updated_at).getTime() + 2 * 60000)
      .toISOString().slice(0, 19) + "Z";
    const before = Object.keys(listings).length;
    for (const [key, item] of Object.entries(listings)) {
      const seen = item.first_seen || "";
      if (seen >= from && seen <= to) delete listings[key];
    }
    const removed = before - Object.keys(listings).length;
    if (!removed) {
      setStatus($("runs-status"), `La corrida #${run.run_number} no guardó avisos nuevos; nada para borrar`);
      setRowStats(run.id, '<span class="badge">sin avisos propios para borrar</span>');
      return;
    }
    await putFile(
      "data/listings.json",
      JSON.stringify(listings, null, 2) + "\n",
      sha,
      `chore: borrar ${removed} avisos de la corrida #${run.run_number} desde la web`
    );
    allListings = Object.values(listings);
    populateSearchSelects();
    applySearch();
    renderTop();
    setRowStats(run.id, `<span class="badge run-ok">${icon("trash", 13)} ${removed} avisos borrados del histórico</span>`);
    setStatus($("runs-status"), `${removed} avisos de la corrida #${run.run_number} borrados del histórico`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "" + err.message, "error");
    alert(`No pude borrar los datos de la corrida #${run.run_number}: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Editor de zonas (mapa de seguridad del usuario) ---------- */

const ZONE_LABELS = {
  alta: { txt: "Inseguridad alta", cls: "flag-high" },
  media: { txt: "Inseguridad media", cls: "flag-med" },
  baja: { txt: "Tranquila", cls: "flag-low" },
};

function renderZones() {
  const entries = Object.entries(zones);
  $("zones-list").innerHTML = entries.length
    ? entries.map(([name, level]) => {
        const m = ZONE_LABELS[level] || ZONE_LABELS.media;
        return `<div class="zone-row">
          <span class="zone-name">${escapeHtml(name)}</span>
          <span class="flag ${m.cls}">${m.txt}</span>
          <button class="btn small danger" data-zone-del="${escapeHtml(name)}">${icon("trash")} Quitar</button>
        </div>`;
      }).join("")
    : '<p class="status">Todavía no cargaste zonas. Agregá los barrios que conocés con su nivel de inseguridad.</p>';
}

async function persistZones(msg) {
  setStatus($("zones-status"), "Guardando zonas...");
  try {
    zonesSha = await putFile("data/zones.json", JSON.stringify(zones, null, 2) + "\n", zonesSha, "chore: actualizar mapa de zonas desde la web");
    renderZones();
    if (allListings.length) { applySearch(); renderTop(); }
    setStatus($("zones-status"), msg || "Guardado", "ok");
  } catch (err) {
    try {
      const { sha } = await fetchFile("data/zones.json");
      zonesSha = await putFile("data/zones.json", JSON.stringify(zones, null, 2) + "\n", sha, "chore: actualizar mapa de zonas desde la web");
      renderZones();
      setStatus($("zones-status"), msg || "Guardado", "ok");
    } catch (err2) {
      setStatus($("zones-status"), "No se pudo guardar: " + err2.message, "error");
    }
  }
}

$("zone-add").addEventListener("click", () => {
  const name = $("zone-name").value.trim().toLowerCase();
  if (!name) { setStatus($("zones-status"), "Escribí un barrio o zona", "error"); return; }
  zones[name] = $("zone-level").value;
  $("zone-name").value = "";
  persistZones(`Zona "${name}" guardada`);
});

$("zones-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-zone-del]");
  if (!btn) return;
  delete zones[btn.dataset.zoneDel];
  persistZones("Zona quitada");
});

/* ---------- Notas por propiedad (reseñas propias) ---------- */

let noteEditingId = null;

function openNoteModal(id) {
  const listing = allListings.find((l) => l.id === id) || Object.values(favorites).find((l) => l.id === id);
  noteEditingId = id;
  const existing = userNotes[id] || {};
  $("note-target").textContent = listing ? (listing.title || listing.address || id) : id;
  $("note-level").value = existing.level || "";
  $("note-text").value = existing.note || "";
  setStatus($("note-status"), "");
  $("note-delete").classList.toggle("hidden", !userNotes[id]);
  $("note-modal").classList.remove("hidden");
  $("note-text").focus();
}

function closeNoteModal() {
  $("note-modal").classList.add("hidden");
  noteEditingId = null;
}

async function persistNotes() {
  try {
    notesSha = await putFile("data/notes.json", JSON.stringify(userNotes, null, 2) + "\n", notesSha, "chore: actualizar notas de propiedades desde la web");
  } catch (err) {
    const { sha } = await fetchFile("data/notes.json");
    notesSha = await putFile("data/notes.json", JSON.stringify(userNotes, null, 2) + "\n", sha, "chore: actualizar notas de propiedades desde la web");
  }
}

document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-note]");
  if (btn) { e.preventDefault(); openNoteModal(btn.dataset.note); }
});

$("note-cancel").addEventListener("click", closeNoteModal);
$("note-modal").addEventListener("click", (e) => { if (e.target === $("note-modal")) closeNoteModal(); });

$("note-save").addEventListener("click", async () => {
  if (!noteEditingId) return;
  const note = $("note-text").value.trim();
  const level = $("note-level").value;
  if (!note && !level) { closeNoteModal(); return; }
  userNotes[noteEditingId] = { note, level };
  const id = noteEditingId;
  closeNoteModal();
  applySearch(); renderTop(); renderFavorites();
  riskQueue = riskQueue.then(persistNotes).catch(() => {});
  setStatus($("results-status"), "Nota guardada", "ok");
});

$("note-delete").addEventListener("click", async () => {
  if (!noteEditingId || !userNotes[noteEditingId]) { closeNoteModal(); return; }
  delete userNotes[noteEditingId];
  closeNoteModal();
  applySearch(); renderTop(); renderFavorites();
  riskQueue = riskQueue.then(persistNotes).catch(() => {});
});

/* Selección de comuna/barrio en el mapa */
document.body.addEventListener("click", (e) => {
  const path = e.target.closest("#crime-map .comuna");
  if (!path) return;
  document.querySelectorAll("#crime-map .comuna.sel").forEach((x) => x.classList.remove("sel"));
  path.classList.add("sel");
  if (path.dataset.barrio !== undefined) showComunaDetail(path.dataset.barrio);
  else showComunaDetail(Number(path.dataset.comuna));
});

/* Toggle Comuna / Barrio del mapa de inseguridad */
if ($("map-mode")) {
  $("map-mode").addEventListener("click", (e) => {
    const btn = e.target.closest(".seg-btn");
    if (!btn || btn.dataset.mapMode === mapMode) return;
    mapMode = btn.dataset.mapMode;
    $("map-mode").querySelectorAll(".seg-btn").forEach((b) =>
      b.classList.toggle("active", b === btn));
    renderCrimeMap();
  });
}

/* ---------- Init ---------- */

hydrateIcons();
updateHint();
loadTopPrefs();
applyTheme(localStorage.getItem(THEME_KEY) || "light");
if (localStorage.getItem(GATE_KEY) === ACCESS_HASH) unlockApp();
else showLogin();
