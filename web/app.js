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
    '⚠️ MercadoLibre bloquea a los servidores de GitHub: para scrapearlo hace falta el secret SCRAPERAPI_KEY en el repo (ScraperAPI tiene plan gratuito). Ej: https://inmuebles.mercadolibre.com.ar/departamentos/alquiler/capital-federal/',
  zonaprop:
    '⚠️ Zonaprop usa protección Cloudflare y suele bloquear a los servidores de GitHub: para scrapearlo hace falta el secret SCRAPERAPI_KEY en el repo (ScraperAPI tiene plan gratuito). Ej: https://www.zonaprop.com.ar/departamentos-alquiler-palermo.html',
  remax:
    'Entrá a <a href="https://www.remax.com.ar" target="_blank" rel="noopener">remax.com.ar</a>, buscá con los filtros del sitio y pegá la URL de resultados (la que empieza con /listings/...). Ej: https://www.remax.com.ar/listings/rent?page=0&pageSize=24&in:operationId=2',
};

let token = localStorage.getItem(TOKEN_KEY) || "";
let jobsDoc = null; // contenido de jobs.json
let jobsSha = null; // sha del archivo para poder commitear
let dirty = false;
let editingIndex = null; // null = nuevo

const $ = (id) => document.getElementById(id);

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
    setStatus($("login-status"), "❌ Usuario o contraseña incorrectos", "error");
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
  $("theme-toggle").textContent = theme === "light" ? "🌙" : "☀️";
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
    setStatus($("auth-status"), `✅ Conectado a ${repo.full_name}`, "ok");
    $("token-input").value = "••••••••";
    $("token-save").classList.add("hidden");
    $("token-clear").classList.remove("hidden");
    $("auth-details").open = false; // colapsar: el semáforo ya informa
    $("tabs").classList.remove("hidden");
    $("main").classList.remove("hidden");
    await loadJobs();
  } catch (err) {
    setConnState("red", "Error de conexión con GitHub");
    setStatus($("auth-status"), "❌ " + err.message, "error");
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
      : { retention_days: 60, defaults: { max_pages: 2 }, searches: [] };
    if (!Array.isArray(jobsDoc.searches)) jobsDoc.searches = [];
    dirty = false;
    renderJobs();
    setStatus($("jobs-status"), `${jobsDoc.searches.length} jobs`);
  } catch (err) {
    setStatus($("jobs-status"), "❌ " + err.message, "error");
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
  if (f.min_surface_m2) parts.push(`${f.min_surface_m2}+ m²`);
  if (f.require_price) parts.push("con precio");
  if (f.keywords_include?.length) parts.push(`incluye: ${f.keywords_include.join(", ")}`);
  if (f.keywords_exclude?.length) parts.push(`excluye: ${f.keywords_exclude.join(", ")}`);
  return parts.join(" · ") || "sin filtros extra";
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
    det.innerHTML = `
      <summary>
        <span class="dot ${enabled ? "green" : "yellow"}" title="${enabled ? "Activo" : "Pausado"}"></span>
        <span class="badge ${enabled ? "on" : "off"}">${enabled ? "ACTIVO" : "PAUSADO"}</span>
        <span class="badge">${job.site || "?"}</span>
        <span class="badge">${job.operation === "venta" ? "compra" : job.operation || "?"}</span>
        <span class="job-name">${escapeHtml(job.name || `job ${i + 1}`)}</span>
        <span class="summary-hint">▾ detalles</span>
      </summary>
      <div class="details-body">
        <div class="meta">${escapeHtml(job.url || "")}</div>
        <div class="meta">${escapeHtml(fmtFilters(job.filters))} · ${job.max_pages || 1} pág.</div>
        <div class="row">
          <button class="btn small" data-act="toggle" data-i="${i}" title="${enabled ? "Deja de ejecutarse en el cron (se guarda al instante)" : "Vuelve a ejecutarse cada hora (se guarda al instante)"}">${enabled ? "⏹ Detener" : "▶ Activar"}</button>
          <button class="btn small" data-act="run" data-i="${i}" title="Ejecuta SOLO este job ahora mismo, aunque esté detenido (usa la última versión guardada)">▶️ Ejecutar ahora</button>
          <button class="btn small" data-act="edit" data-i="${i}">✏️ Editar</button>
          <button class="btn small danger" data-act="del" data-i="${i}">🗑 Eliminar</button>
        </div>
      </div>`;
    wrap.appendChild(det);
  });
  $("save-jobs").disabled = !dirty;
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
      `${job.enabled ? "▶ Activado" : "⏹ Detenido"} "${job.name}"`
    );
  } else if (act === "run") {
    runSingleJob(jobsDoc.searches[i]);
  } else if (act === "del") {
    if (confirm(`¿Eliminar el job "${jobsDoc.searches[i].name}"?`)) {
      jobsDoc.searches.splice(i, 1);
      markDirty();
      renderJobs();
    }
  } else if (act === "edit") {
    openForm(i);
  }
});

async function runSingleJob(job) {
  if (dirty && !confirm(
    `Tenés cambios sin guardar: el job va a correr con la última versión GUARDADA de "${job.name}". ¿Continuar?`
  )) return;
  setStatus($("jobs-status"), `Disparando "${job.name}"...`);
  try {
    const dispatchedAt = new Date().toISOString();
    const resp = await gh(`/actions/workflows/scraper.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: BRANCH, inputs: { only_job: job.name } }),
    });
    if (resp.status !== 204) throw new Error(`status ${resp.status}`);
    setStatus($("jobs-status"), `✅ "${job.name}" disparado`, "ok");
    watchRun(`Ejecutando "${job.name}"`, dispatchedAt);
  } catch (err) {
    setStatus($("jobs-status"), "❌ " + err.message, "error");
  }
}

/* ---------- Flujo animado de la corrida en curso ---------- */

const FLOW_STEPS = [
  "🚀 Disparado",
  "⏳ En cola",
  "🔧 Preparando entorno",
  "🕷️ Scrapeando portales",
  "💾 Guardando resultados",
  "✅ Listo",
];
let flowTimer = null;

function renderFlow(title, activeIdx, finished = false, resultHtml = "") {
  const steps = FLOW_STEPS.map((label, i) => {
    const cls = finished || i < activeIdx ? "done" : i === activeIdx ? "active" : "pending";
    return `<div class="flow-step ${cls}"><span class="flow-dot"></span><span class="flow-label">${label}</span></div>`;
  }).join('<div class="flow-line"></div>');
  $("run-flow").classList.remove("hidden");
  $("run-flow").innerHTML = `
    <div class="flow-title">${escapeHtml(title)}</div>
    <div class="flow-track">${steps}</div>
    ${resultHtml ? `<div class="flow-result">${resultHtml}</div>` : ""}`;
}

function watchRun(title, dispatchedAt) {
  clearInterval(flowTimer);
  renderFlow(title, 0);
  let runId = null;
  let ticks = 0;
  flowTimer = setInterval(async () => {
    if (++ticks > 60) { // ~5 minutos de vigilancia máxima
      clearInterval(flowTimer);
      renderFlow(title, FLOW_STEPS.length - 1, true, "La corrida sigue en GitHub; mirá la pestaña Corridas.");
      return;
    }
    try {
      if (!runId) {
        const resp = await gh(`/actions/workflows/scraper.yml/runs?event=workflow_dispatch&per_page=1`);
        const run = (await resp.json()).workflow_runs?.[0];
        if (run && run.created_at >= dispatchedAt.slice(0, 19)) {
          runId = run.id;
          renderFlow(title, 1);
        }
        return;
      }
      const resp = await gh(`/actions/runs/${runId}/jobs`);
      const job = (await resp.json()).jobs?.[0];
      if (!job || job.status === "queued") { renderFlow(title, 1); return; }
      if (job.status === "in_progress") {
        const steps = job.steps || [];
        const running = (name) =>
          steps.some((s) => s.name.includes(name) && s.status === "in_progress");
        const doneStep = (name) =>
          steps.some((s) => s.name.includes(name) && s.status === "completed");
        if (running("Commitear") || doneStep("Ejecutar scraper")) renderFlow(title, 4);
        else if (running("Ejecutar scraper")) renderFlow(title, 3);
        else renderFlow(title, 2);
        return;
      }
      if (job.status === "completed") {
        clearInterval(flowTimer);
        const ok = job.conclusion === "success";
        let result = "❌ La corrida falló — abrí el log desde la pestaña Corridas.";
        if (ok) {
          const history = await loadRunHistory();
          const h = history[history.length - 1];
          result = h && h.finished_at >= dispatchedAt.slice(0, 19)
            ? `🆕 ${h.new} avisos nuevos · 📋 ${h.found} encontrados` +
              (h.errors?.length ? ` · ⚠️ ${h.errors.length} avisos de error` : "")
            : "Completado (sin actividad registrada).";
          loadResults(); // refresca Buscar y Top con lo nuevo
        }
        renderFlow(title, FLOW_STEPS.length - 1, ok, escapeHtml(result));
      }
    } catch { /* reintenta en el próximo tick */ }
  }, 5000);
}

function markDirty() {
  dirty = true;
  $("save-jobs").disabled = false;
  setStatus($("jobs-status"), "Cambios sin guardar", "error");
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
}

["f-mode", "f-site", "f-operation", "f-ptype"].forEach((id) =>
  $(id).addEventListener("change", syncBuilder)
);
$("f-zone").addEventListener("input", syncBuilder);

function updateHint() {
  $("site-hint").innerHTML = SITE_HINTS[$("f-site").value] || "";
}
$("f-site").addEventListener("change", updateHint);
$("f-url").addEventListener("input", () => {
  const s = detectSite($("f-url").value);
  if (s) {
    $("f-site").value = s;
    updateHint();
  }
});

function openForm(index) {
  editingIndex = index;
  const job = index != null ? jobsDoc.searches[index] : null;
  $("job-form-title").textContent = job ? `Editar: ${job.name}` : "Nuevo job";
  const f = job?.filters || {};
  $("f-name").value = job?.name || "";
  $("f-site").value = job?.site || "argenprop";
  $("f-operation").value = job?.operation === "venta" ? "venta" : "alquiler";
  // Jobs existentes conservan su URL tal cual (modo URL); los nuevos
  // arrancan con el armador de menús y valores limpios.
  $("f-mode").value = job ? "url" : "menu";
  $("f-ptype").value = "departamento";
  $("f-zone").value = "";
  $("f-url").value = job?.url || "";
  $("f-max-pages").value = job?.max_pages ?? jobsDoc.defaults?.max_pages ?? 2;
  $("f-enabled").value = String(job ? job.enabled !== false : true);
  $("f-currency").value = f.currency || "";
  $("f-min-price").value = f.min_price ?? "";
  $("f-max-price").value = f.max_price ?? "";
  $("f-min-rooms").value = f.min_rooms ?? "";
  $("f-max-rooms").value = f.max_rooms ?? "";
  $("f-min-bedrooms").value = f.min_bedrooms ?? "";
  $("f-min-surface").value = f.min_surface_m2 ?? "";
  $("f-require-price").value = String(!!f.require_price);
  $("f-kw-include").value = (f.keywords_include || []).join(", ");
  $("f-kw-exclude").value = (f.keywords_exclude || []).join(", ");
  syncBuilder();
  $("job-form-wrap").classList.remove("hidden");
  $("f-name").focus();
}

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
    ["min_bedrooms", "f-min-bedrooms"], ["min_surface_m2", "f-min-surface"],
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
    name: $("f-name").value.trim(),
    url,
    site,
    operation: $("f-operation").value,
    enabled: $("f-enabled").value === "true",
    max_pages: numOrNull("f-max-pages") || 1,
    filters,
  };
  if (editingIndex != null) jobsDoc.searches[editingIndex] = job;
  else jobsDoc.searches.push(job);
  $("job-form-wrap").classList.add("hidden");
  markDirty();
  renderJobs();
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
    dirty = false;
    renderJobs();
    setStatus($("jobs-status"), `✅ ${okMessage || "Guardado"}. El cron ya usa esta config.`, "ok");
  } catch (err) {
    setStatus($("jobs-status"), "❌ " + err.message, "error");
  }
}

$("save-jobs").addEventListener("click", () => persistJobs("Guardado"));

$("run-now").addEventListener("click", async () => {
  if (dirty && !confirm("Tenés cambios sin guardar; el scraper va a correr con la última versión GUARDADA. ¿Continuar?")) return;
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
    setStatus($("jobs-status"), `✅ Scraper disparado (${active} jobs activos).`, "ok");
    watchRun(`Ejecutando ${active} jobs activos`, dispatchedAt);
  } catch (err) {
    setStatus($("jobs-status"), "❌ " + err.message, "error");
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
    populateSearchSelects();
    applySearch();
    renderTop();
  } catch (err) {
    setStatus($("results-status"), "❌ " + err.message, "error");
    setStatus($("top-status"), "❌ " + err.message, "error");
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

function applySearch() {
  const q = $("s-text").value.trim().toLowerCase();
  const site = $("s-site").value;
  const job = $("s-job").value;
  const operation = $("s-operation").value;
  const currency = $("s-currency").value;
  const pmin = numVal("s-min-price");
  const pmax = numVal("s-max-price");
  const rooms = numVal("s-min-rooms");
  const beds = numVal("s-min-bedrooms");
  const surf = numVal("s-min-surface");
  const since = $("s-since").value; // yyyy-mm-dd, comparable con first_seen ISO

  const out = allListings.filter((l) => {
    if (q && !`${l.title} ${l.address} ${l.search_name}`.toLowerCase().includes(q)) return false;
    if (site && l.site !== site) return false;
    if (job && l.search_name !== job) return false;
    if (operation && listingOperation(l) !== operation) return false;
    if (currency && l.price_currency !== currency) return false;
    if (pmin != null && !(l.price_amount != null && l.price_amount >= pmin)) return false;
    if (pmax != null && !(l.price_amount != null && l.price_amount <= pmax)) return false;
    if (rooms != null && !(l.rooms != null && l.rooms >= rooms)) return false;
    if (beds != null && !(l.bedrooms != null && l.bedrooms >= beds)) return false;
    if (surf != null && !(l.surface_m2 != null && l.surface_m2 >= surf)) return false;
    if (since && (l.first_seen || "") < since) return false;
    return true;
  });

  const sorters = {
    recent: (a, b) => (b.first_seen || "").localeCompare(a.first_seen || ""),
    price_asc: (a, b) => (a.price_amount ?? Infinity) - (b.price_amount ?? Infinity),
    price_desc: (a, b) => (b.price_amount ?? -1) - (a.price_amount ?? -1),
    surface_desc: (a, b) => (b.surface_m2 ?? -1) - (a.surface_m2 ?? -1),
  };
  out.sort(sorters[$("s-sort").value] || sorters.recent);

  renderResults(out);
  setStatus($("results-status"), `${out.length} de ${allListings.length} avisos`);
}

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
    title="${on ? "Quitar de Me gustan" : "Guardar en Me gustan"}">${on ? "❤️" : "🤍"}</button>`;
}

function refreshHearts() {
  document.querySelectorAll("button[data-fav]").forEach((btn) => {
    const on = isFav(btn.dataset.fav);
    btn.classList.toggle("on", on);
    btn.textContent = on ? "❤️" : "🤍";
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
      setStatus($("fav-status"), "❌ No pude guardar: " + err2.message, "error");
      return;
    }
  }
  setStatus($("fav-status"), `✅ ${Object.keys(favorites).length} favoritos guardados en el repo`, "ok");
}

document.body.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-fav]");
  if (!btn) return;
  e.preventDefault();
  toggleFavorite(btn.dataset.fav);
});

function favCardHtml(l) {
  const imgs = (l.images && l.images.length ? l.images : [l.image]).filter(Boolean);
  const photo = imgs.length
    ? `<img class="zoomable" src="${escapeHtml(imgs[0])}" loading="lazy" alt=""
        onerror="this.outerHTML='<div class=\\'noimg\\'>🏠</div>'">`
    : `<div class="noimg">🏠</div>`;
  const meta = [
    l.rooms ? `${l.rooms} amb` : null,
    l.surface_m2 ? `${Math.round(l.surface_m2)} m²` : null,
  ].filter(Boolean).join(" · ");
  return `
    <div class="top-card">
      <div class="top-thumb">${photo}
        <button class="fav-btn on thumb-fav" data-fav="${escapeHtml(l.id)}" title="Quitar de Me gustan">❤️</button>
      </div>
      <div class="top-body">
        <div class="top-price">${fmtPrice(l)}</div>
        <a class="top-title" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a>
        <div class="top-meta">${escapeHtml(meta)}</div>
        <div class="top-meta">${escapeHtml(l.address || "")}</div>
        <div class="top-meta"><span class="badge">${escapeHtml(l.site)}</span> ${escapeHtml((l.saved_at || "").slice(0, 10))}</div>
      </div>
    </div>`;
}

function renderFavorites() {
  const items = Object.values(favorites).sort((a, b) =>
    (b.saved_at || "").localeCompare(a.saved_at || "")
  );
  $("fav-list").innerHTML = items.length
    ? `<div class="fav-grid">${items.map(favCardHtml).join("")}</div>`
    : '<p class="status">Todavía no guardaste ningún aviso. Tocá el 🤍 en la pestaña Buscar o en el Top 5.</p>';
  if (favLoaded) setStatus($("fav-status"), `${items.length} guardados`);
}

$("reload-fav").addEventListener("click", () => loadFavorites().then(renderFavorites));

function thumbHtml(l, cls = "thumb") {
  if (!l.image) return `<div class="${cls} noimg">🏠</div>`;
  return `<img class="${cls} zoomable" src="${escapeHtml(l.image)}" loading="lazy" alt=""
    onerror="this.outerHTML='<div class=\\'${cls} noimg\\'>🏠</div>'">`;
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
      <td>${escapeHtml((l.first_seen || "").slice(0, 16).replace("T", " "))}</td>
      <td><span class="badge">${escapeHtml(l.site)}</span></td>
      <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a><br>
          <small>${escapeHtml(l.address || "")}</small></td>
      <td>${fmtPrice(l)}</td>
      <td>${l.rooms ?? "-"} amb / ${l.surface_m2 ? l.surface_m2 + " m²" : "-"}</td>
      <td><small>${escapeHtml(l.search_name || "")}</small></td>
      <td>${heartHtml(l)}</td>
    </tr>`).join("");
  $("results-list").innerHTML = `
    <table>
      <thead><tr><th>Foto</th><th>Visto</th><th>Portal</th><th>Aviso</th><th>Precio</th><th>Amb/m²</th><th>Job</th><th>♥</th></tr></thead>
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

/* Score 0-1 entre avisos de la misma operación: mejor precio (50%),
 * más superficie (30%), más ambientes (20%). El precio solo se compara
 * contra avisos de la misma moneda. */
function computeTop(operation, count = 5) {
  const group = allListings.filter(
    (l) => listingOperation(l) === operation && l.price_amount != null
  );
  if (!group.length) return [];

  const byCurrency = {};
  for (const l of group) {
    (byCurrency[l.price_currency || "?"] ||= []).push(l.price_amount);
  }
  const range = (values) => [Math.min(...values), Math.max(...values)];
  const priceRanges = Object.fromEntries(
    Object.entries(byCurrency).map(([c, v]) => [c, range(v)])
  );
  const surfs = group.filter((l) => l.surface_m2).map((l) => l.surface_m2);
  const [smin, smax] = surfs.length ? range(surfs) : [0, 0];
  const rooms = group.filter((l) => l.rooms).map((l) => l.rooms);
  const [rmin, rmax] = rooms.length ? range(rooms) : [0, 0];

  const norm = (v, min, max) => (max > min ? (v - min) / (max - min) : 0.5);

  const scored = group.map((l) => {
    const [pmin, pmax] = priceRanges[l.price_currency || "?"];
    const priceScore = 1 - norm(l.price_amount, pmin, pmax); // más barato mejor
    const surfScore = l.surface_m2 ? norm(l.surface_m2, smin, smax) : 0.4;
    const roomScore = l.rooms ? norm(l.rooms, rmin, rmax) : 0.4;
    return { l, score: 0.5 * priceScore + 0.3 * surfScore + 0.2 * roomScore };
  });
  scored.sort((a, b) => b.score - a.score || (b.l.first_seen || "").localeCompare(a.l.first_seen || ""));
  return scored.slice(0, count);
}

function topCardHtml({ l, score }, rank) {
  const imgs = (l.images && l.images.length ? l.images : [l.image]).filter(Boolean);
  const imgAttr = imgs.length > 1 ? `data-images='${escapeHtml(JSON.stringify(imgs))}'` : "";
  const photo = imgs.length
    ? `<img class="zoomable cycling" src="${escapeHtml(imgs[0])}" loading="lazy" alt="" ${imgAttr}
        onerror="this.outerHTML='<div class=\\'noimg\\'>🏠</div>'">`
    : `<div class="noimg">🏠</div>`;
  const meta = [
    l.rooms ? `${l.rooms} amb` : null,
    l.surface_m2 ? `${Math.round(l.surface_m2)} m²` : null,
  ].filter(Boolean).join(" · ");
  return `
    <div class="top-card">
      <div class="top-thumb">${photo}<span class="top-rank">#${rank}</span>
        <span class="thumb-fav">${heartHtml(l)}</span>
      </div>
      <div class="top-body">
        <div class="top-price">${fmtPrice(l)} <span class="badge">match ${Math.round(score * 100)}%</span></div>
        <a class="top-title" href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a>
        <div class="top-meta">${escapeHtml(meta)}</div>
        <div class="top-meta">${escapeHtml(l.address || "")}</div>
        <div class="top-meta"><span class="badge">${escapeHtml(l.site)}</span> ${escapeHtml(l.search_name || "")}</div>
      </div>
    </div>`;
}

function renderTopGroup(operation, container) {
  const top = computeTop(operation);
  if (!top.length) {
    container.innerHTML = `<p class="status">Todavía no hay avisos de ${operation === "venta" ? "venta" : "alquiler"} guardados. Activá un job de esa operación y ejecutá el scraper.</p>`;
    return;
  }
  const cards = top.map((item, i) => topCardHtml(item, i + 1)).join("");
  // con suficientes tarjetas el carrusel se desliza solo (se pausa con el mouse)
  const animate = top.length >= 3;
  container.innerHTML = `
    <div class="carousel${animate ? " auto" : ""}">
      <div class="carousel-track">${cards}${animate ? cards : ""}</div>
    </div>`;
}

function renderTop() {
  renderTopGroup("alquiler", $("top-rent"));
  renderTopGroup("venta", $("top-buy"));
  setStatus($("top-status"), `${allListings.length} avisos analizados`);
  startImageCycling();
}

$("reload-top").addEventListener("click", loadResults);

/* Las tarjetas con varias fotos (Remax) van rotando la imagen */
let cyclingTimer = null;
function startImageCycling() {
  if (cyclingTimer) clearInterval(cyclingTimer);
  cyclingTimer = setInterval(() => {
    document.querySelectorAll("img.cycling[data-images]").forEach((img) => {
      try {
        const imgs = JSON.parse(img.dataset.images);
        const idx = (Number(img.dataset.idx || 0) + 1) % imgs.length;
        img.dataset.idx = idx;
        img.src = imgs[idx];
      } catch { /* data-images inválido: se ignora */ }
    });
  }, 2500);
}

/* ---------- Preview ampliado al pasar el mouse ---------- */

const imgPreview = document.createElement("img");
imgPreview.id = "img-preview";
document.body.appendChild(imgPreview);

document.body.addEventListener("mouseover", (e) => {
  const img = e.target.closest("img.zoomable");
  if (!img) return;
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

$("reload-results").addEventListener("click", loadResults);

const SEARCH_TEXT_FIELDS = ["s-text", "s-min-price", "s-max-price", "s-min-rooms", "s-min-bedrooms", "s-min-surface", "s-since"];
const SEARCH_SELECT_FIELDS = ["s-site", "s-job", "s-operation", "s-currency", "s-sort"];
SEARCH_TEXT_FIELDS.forEach((id) => $(id).addEventListener("input", applySearch));
SEARCH_SELECT_FIELDS.forEach((id) => $(id).addEventListener("change", applySearch));

$("search-clear").addEventListener("click", () => {
  SEARCH_TEXT_FIELDS.forEach((id) => ($(id).value = ""));
  SEARCH_SELECT_FIELDS.forEach((id) => ($(id).value = id === "s-sort" ? "recent" : ""));
  applySearch();
});

/* ---------- Corridas ---------- */

const RUN_ICONS = { success: "✅", failure: "❌", cancelled: "⚪", in_progress: "🔄", queued: "⏳" };

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
    `<span class="badge run-ok">🆕 ${h.new} nuevos</span>`,
    `<span class="badge">📋 ${h.found} encontrados</span>`,
  ];
  if (h.only_job) parts.push(`<span class="badge">solo: ${escapeHtml(h.only_job)}</span>`);
  if (h.errors && h.errors.length) {
    parts.push(`<span class="badge run-warn" title="${escapeHtml(h.errors.join(" | "))}">⚠️ ${h.errors.length} avisos de error</span>`);
  }
  return parts.join(" ");
}

async function loadRuns() {
  setStatus($("runs-status"), "Cargando corridas...");
  try {
    const [resp, history] = await Promise.all([
      gh(`/actions/workflows/scraper.yml/runs?per_page=15`),
      loadRunHistory(),
    ]);
    const data = await resp.json();
    // Más nuevas arriba, siempre
    runsCache = (data.workflow_runs || []).sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
    const rows = runsCache.map((r) => {
      const icon = RUN_ICONS[r.conclusion || r.status] || "▫️";
      const when = new Date(r.created_at).toLocaleString("es-AR");
      const h = historyForRun(r, history);
      // Solo se deshabilita cuando el historial CONFIRMA que no guardó
      // nada; corridas sin historial (anteriores a esta función) pueden
      // tener avisos, así que el botón queda habilitado.
      const knownEmpty = Boolean(h) && !(h.new > 0);
      const delTitle = knownEmpty
        ? "Esta corrida no guardó avisos nuevos: no hay datos para borrar"
        : h
          ? `Borra del histórico los ${h.new} avisos que guardó esta corrida`
          : "Borra del histórico los avisos que guardó esta corrida";
      return `<div class="run-row" data-row-run="${r.id}">
        <span>${icon} <strong>#${r.run_number}</strong> · ${escapeHtml(r.event)} · ${when}<br>
          <span class="run-stats">${runStatsHtml(r, history)}</span>
        </span>
        <span class="row">
          <a href="${r.html_url}" target="_blank" rel="noopener">ver log →</a>
          <button class="btn small danger" data-run="${r.id}" ${knownEmpty ? "disabled" : ""} title="${escapeHtml(delTitle)}">🗑 Borrar datos</button>
          <button class="btn small" data-del-run="${r.id}" title="Elimina esta corrida de la lista (no toca los avisos guardados)">🧹 Borrar corrida</button>
        </span>
      </div>`;
    }).join("");
    $("runs-list").innerHTML = rows || '<p class="status">Sin corridas todavía.</p>';
    setStatus($("runs-status"), "");
  } catch (err) {
    setStatus($("runs-status"), "❌ " + err.message, "error");
  }
}

$("reload-runs").addEventListener("click", loadRuns);

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
    setStatus($("runs-status"), `✅ Corrida #${run.run_number} eliminada de la lista`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "❌ " + err.message, "error");
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
    setRowStats(run.id, `<span class="badge run-ok">🗑 ${removed} avisos borrados del histórico</span>`);
    setStatus($("runs-status"), `✅ ${removed} avisos de la corrida #${run.run_number} borrados del histórico`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "❌ " + err.message, "error");
    alert(`No pude borrar los datos de la corrida #${run.run_number}: ${err.message}`);
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Init ---------- */

updateHint();
applyTheme(localStorage.getItem(THEME_KEY) || "light");
if (localStorage.getItem(GATE_KEY) === ACCESS_HASH) unlockApp();
else showLogin();
