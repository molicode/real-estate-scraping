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
    'Entrá a <a href="https://inmuebles.mercadolibre.com.ar" target="_blank" rel="noopener">inmuebles.mercadolibre.com.ar</a>, aplicá los filtros y pegá la URL de resultados. Ej: https://inmuebles.mercadolibre.com.ar/departamentos/alquiler/capital-federal/',
  zonaprop:
    '⚠️ Zonaprop usa protección Cloudflare y suele bloquear a los servidores de GitHub: el job puede devolver 0 avisos. Ej: https://www.zonaprop.com.ar/departamentos-alquiler-palermo.html',
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
  wrap.innerHTML = "";
  if (!jobsDoc.searches.length) {
    wrap.innerHTML = '<p class="status">No hay jobs todavía. Creá el primero con "Nuevo job".</p>';
  }
  jobsDoc.searches.forEach((job, i) => {
    const enabled = job.enabled !== false;
    const div = document.createElement("div");
    div.className = "job-card" + (enabled ? "" : " disabled");
    div.innerHTML = `
      <div>
        <div class="title">
          <span class="badge ${enabled ? "on" : "off"}">${enabled ? "ACTIVO" : "PAUSADO"}</span>
          <span class="badge">${job.site || "?"}</span>
          ${escapeHtml(job.name || `job ${i + 1}`)}
        </div>
        <div class="meta">${escapeHtml(job.url || "")}</div>
        <div class="meta">${escapeHtml(fmtFilters(job.filters))} · ${job.max_pages || 1} pág.</div>
      </div>
      <div class="row">
        <button class="btn small" data-act="toggle" data-i="${i}">${enabled ? "⏸ Pausar" : "▶ Activar"}</button>
        <button class="btn small" data-act="edit" data-i="${i}">✏️ Editar</button>
        <button class="btn small danger" data-act="del" data-i="${i}">🗑</button>
      </div>`;
    wrap.appendChild(div);
  });
  $("save-jobs").disabled = !dirty;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[c]);
}

$("jobs-list").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-act]");
  if (!btn) return;
  const i = Number(btn.dataset.i);
  const act = btn.dataset.act;
  if (act === "toggle") {
    jobsDoc.searches[i].enabled = jobsDoc.searches[i].enabled === false;
    markDirty();
    renderJobs();
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
  updateHint();
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

$("save-jobs").addEventListener("click", async () => {
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
    setStatus($("jobs-status"), "✅ Guardado. El próximo cron (o 'Ejecutar ahora') usa esta config.", "ok");
  } catch (err) {
    setStatus($("jobs-status"), "❌ " + err.message, "error");
  }
});

$("run-now").addEventListener("click", async () => {
  if (dirty && !confirm("Tenés cambios sin guardar; el scraper va a correr con la última versión GUARDADA. ¿Continuar?")) return;
  setStatus($("jobs-status"), "Disparando workflow...");
  try {
    const resp = await gh(`/actions/workflows/scraper.yml/dispatches`, {
      method: "POST",
      body: JSON.stringify({ ref: BRANCH }),
    });
    if (resp.status !== 204) throw new Error(`status ${resp.status}`);
    setStatus($("jobs-status"), "✅ Scraper disparado. Mirá el estado en la pestaña Corridas.", "ok");
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
    populateSearchSelects();
    applySearch();
  } catch (err) {
    setStatus($("results-status"), "❌ " + err.message, "error");
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

function renderResults(listings) {
  if (!listings.length) {
    $("results-list").innerHTML =
      '<p class="status">Ningún aviso coincide con los filtros. Probá aflojar alguno o tocá "Limpiar filtros".</p>';
    return;
  }
  const rows = listings.map((l) => `
    <tr>
      <td>${escapeHtml((l.first_seen || "").slice(0, 16).replace("T", " "))}</td>
      <td><span class="badge">${escapeHtml(l.site)}</span></td>
      <td><a href="${escapeHtml(l.url)}" target="_blank" rel="noopener">${escapeHtml(l.title || l.address || "ver aviso")}</a><br>
          <small>${escapeHtml(l.address || "")}</small></td>
      <td>${fmtPrice(l)}</td>
      <td>${l.rooms ?? "-"} amb / ${l.surface_m2 ? l.surface_m2 + " m²" : "-"}</td>
      <td><small>${escapeHtml(l.search_name || "")}</small></td>
    </tr>`).join("");
  $("results-list").innerHTML = `
    <table>
      <thead><tr><th>Visto</th><th>Portal</th><th>Aviso</th><th>Precio</th><th>Amb/m²</th><th>Job</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>`;
}

$("reload-results").addEventListener("click", loadResults);

const SEARCH_TEXT_FIELDS = ["s-text", "s-min-price", "s-max-price", "s-min-rooms", "s-min-bedrooms", "s-min-surface", "s-since"];
const SEARCH_SELECT_FIELDS = ["s-site", "s-job", "s-currency", "s-sort"];
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

async function loadRuns() {
  setStatus($("runs-status"), "Cargando corridas...");
  try {
    const resp = await gh(`/actions/workflows/scraper.yml/runs?per_page=15`);
    const data = await resp.json();
    // Más nuevas arriba, siempre
    runsCache = (data.workflow_runs || []).sort((a, b) =>
      (b.created_at || "").localeCompare(a.created_at || "")
    );
    const rows = runsCache.map((r) => {
      const icon = RUN_ICONS[r.conclusion || r.status] || "▫️";
      const when = new Date(r.created_at).toLocaleString("es-AR");
      return `<div class="run-row">
        <span>${icon} <strong>#${r.run_number}</strong> · ${escapeHtml(r.event)} · ${when}</span>
        <span class="row">
          <a href="${r.html_url}" target="_blank" rel="noopener">ver log →</a>
          <button class="btn small danger" data-run="${r.id}" title="Borra del histórico los avisos que guardó esta corrida">🗑 Borrar datos</button>
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
$("runs-list").addEventListener("click", async (e) => {
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
    setStatus($("runs-status"), `✅ ${removed} avisos de la corrida #${run.run_number} borrados del histórico`, "ok");
  } catch (err) {
    setStatus($("runs-status"), "❌ " + err.message, "error");
  } finally {
    btn.disabled = false;
  }
});

/* ---------- Init ---------- */

updateHint();
applyTheme(localStorage.getItem(THEME_KEY) || "light");
if (localStorage.getItem(GATE_KEY) === ACCESS_HASH) unlockApp();
else showLogin();
