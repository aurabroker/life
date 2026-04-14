// =============================================================================
//  KONFIGURACJA SUPABASE
//  Klucz anon jest publiczny z założenia — bezpieczeństwo zapewniają
//  polityki RLS po stronie bazy danych (nie ten plik).
// =============================================================================
const SB_URL = 'https://kukvgsjrmrqtzhkszzum.supabase.co';
const SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imt1a3Znc2pybXJxdHpoa3N6enVtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzI5MTI0NzYsImV4cCI6MjA4ODQ4ODQ3Nn0.wOB-4CJTcRksSUY7WD7CXEccTKNxPIVF8AT8hczS5zY';

const SB_CLIENT = supabase.createClient(SB_URL, SB_KEY);

// Stan aplikacji
let currentRole = 'viewer';
let currentUser = null;
let quillInstance = null;


// =============================================================================
//  BEZPIECZEŃSTWO — DOMPurify
// =============================================================================
DOMPurify.addHook('afterSanitizeAttributes', (node) => {
  if (node.tagName === 'IFRAME') {
    const src = node.getAttribute('src') || '';
    const allowed = ['youtube.com', 'youtube-nocookie.com', 'youtu.be', 'vimeo.com'];
    if (!allowed.some(d => src.includes(d))) node.removeAttribute('src');
  }
});

function safeHtml(dirty) {
  return DOMPurify.sanitize(dirty || '', {
    FORCE_BODY: true,
    ADD_TAGS: ['iframe'],
    ADD_ATTR: ['allowfullscreen', 'frameborder', 'allow', 'src']
  });
}

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}


// =============================================================================
//  AUTORYZACJA
// =============================================================================
async function checkAuthAndUpdateUI() {
  const { data: { session } } = await SB_CLIENT.auth.getSession();

  if (!session) {
    currentRole = 'viewer';
    currentUser = null;
    updateNavForRole();
    return;
  }

  currentUser = session.user;

  const { data: profile, error } = await SB_CLIENT
    .from('profiles')
    .select('rola')
    .eq('id', session.user.id)
    .single();

  currentRole = (!error && profile?.rola === 'admin') ? 'admin' : 'viewer';
  updateNavForRole();
}

function updateNavForRole() {
  const isAdmin = currentRole === 'admin';
  document.getElementById('adminTabBtn').classList.toggle('hidden', !isAdmin);
  document.getElementById('loginTabBtn').classList.toggle('hidden', isAdmin);
  document.getElementById('logoutBtn').classList.toggle('hidden', !isAdmin);
}

async function doLogin() {
  const email = document.getElementById('loginEmail').value.trim();
  const pass  = document.getElementById('loginPassword').value;
  const errEl = document.getElementById('loginError');
  const btn   = document.getElementById('loginBtn');

  errEl.classList.add('hidden');
  btn.textContent = 'Logowanie...';
  btn.disabled = true;

  const { error } = await SB_CLIENT.auth.signInWithPassword({ email, password: pass });

  btn.textContent = 'Zaloguj się';
  btn.disabled = false;

  if (error) {
    errEl.textContent = 'Błąd: ' + error.message;
    errEl.classList.remove('hidden');
    return;
  }

  closeLoginScreen();
  await checkAuthAndUpdateUI();
  if (currentRole === 'admin') switchTab('admin');
}

async function doLogout() {
  await SB_CLIENT.auth.signOut();
  currentRole = 'viewer';
  currentUser = null;
  updateNavForRole();
  switchTab('home');
}

function showLoginScreen() {
  document.getElementById('loginScreen').classList.remove('hidden');
}

function closeLoginScreen() {
  document.getElementById('loginScreen').classList.add('hidden');
  document.getElementById('loginError').classList.add('hidden');
}

function requireAdminThenSwitch() {
  if (currentRole !== 'admin') { showLoginScreen(); return; }
  switchTab('admin');
}


// =============================================================================
//  NAWIGACJA / ROUTING
// =============================================================================
function switchTab(id, skipHash = false) {
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.tab-btn').forEach(b => {
    b.classList.remove('text-brand-purple', 'bg-purple-50');
    b.classList.add('text-slate-500');
  });

  const panel = document.getElementById('tab-' + id);
  if (panel) panel.classList.add('active');

  const btn = document.querySelector(`.tab-btn[data-tab="${id}"]`);
  if (btn) {
    btn.classList.add('text-brand-purple', 'bg-purple-50');
    btn.classList.remove('text-slate-500');
  }

  if (id === 'blog')  loadPublishedArticles();
  if (id === 'admin') {
    if (currentRole !== 'admin') { switchTab('home'); return; }
    loadAdminArticles();
  }

  if (!skipHash) history.pushState(null, null, '#' + id);
}

async function handleHashChange() {
  const hash = window.location.hash.replace('#', '');
  if (hash.startsWith('article-')) {
    await openArticle(hash.replace('article-', ''), true);
  } else if (hash && document.getElementById('tab-' + hash)) {
    if (hash === 'admin' && currentRole !== 'admin') switchTab('home', true);
    else switchTab(hash, true);
  } else {
    switchTab('home', true);
  }
}

window.addEventListener('hashchange', handleHashChange);


// =============================================================================
//  QUILL — inicjalizacja
// =============================================================================
function initQuill() {
  quillInstance = new Quill('#quillEditor', {
    theme: 'snow',
    placeholder: 'Zacznij pisać swój artykuł tutaj...',
    modules: {
      toolbar: [
        [{ header: [2, 3, false] }],
        ['bold', 'italic', 'underline', 'strike'],
        ['blockquote'],
        [{ list: 'ordered' }, { list: 'bullet' }],
        ['link', 'image', 'video'],
        ['clean']
      ]
    }
  });
}


// =============================================================================
//  CZYTNIK ARTYKUŁÓW
// =============================================================================
async function openArticle(id, skipHashChange = false) {
  const { data, error } = await SB_CLIENT
    .from('aura_articles')
    .select('*')
    .eq('id', id)
    .single();

  if (!data || error) { alert('Nie znaleziono artykułu.'); switchTab('blog'); return; }

  document.getElementById('amTitle').textContent = data.title;
  document.getElementById('amDate').textContent  =
    `Opublikowano: ${new Date(data.published_at || data.created_at).toLocaleString('pl-PL')}`;

  document.getElementById('amContent').innerHTML = safeHtml(data.content);
  document.getElementById('amTags').innerHTML = (data.tags || [])
    .map(t => `<span class="bg-indigo-50 border border-indigo-100 text-brand-purple text-xs px-3 py-1 rounded-lg font-black uppercase tracking-wider">${escapeHtml(t)}</span>`)
    .join('');

  switchTab('article', skipHashChange);
  window.scrollTo(0, 0);
  if (!skipHashChange) history.pushState(null, null, '#article-' + id);
}

function closeArticle() { switchTab('blog'); }

function copyArticleLink() {
  navigator.clipboard.writeText(window.location.href)
    .then(() => alert('Link skopiowany!'))
    .catch(() => alert('Skopiuj ręcznie:\n' + window.location.href));
}


// =============================================================================
//  BLOG PUBLICZNY
// =============================================================================
async function loadPublishedArticles() {
  const grid = document.getElementById('blogGrid');
  grid.innerHTML = '<div class="col-span-full py-20 text-center text-slate-400">Pobieranie artykułów...</div>';

  const { data, error } = await SB_CLIENT
    .from('aura_articles')
    .select('id, title, excerpt, tags, published_at')
    .eq('status', 'published')
    .contains('platforms', ['AuraBenefits'])
    .order('published_at', { ascending: false });

  if (error || !data) {
    grid.innerHTML = '<div class="col-span-full text-center text-red-500 py-10">Błąd połączenia z bazą danych.</div>';
    return;
  }

  if (data.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center text-slate-400 py-10 border-2 border-dashed border-slate-200 rounded-3xl">
        Brak opublikowanych artykułów dla portalu AuraBenefits.
      </div>`;
    return;
  }

  grid.innerHTML = data.map(art => `
    <div class="glass-card rounded-3xl p-8 shadow-sm hover:shadow-xl transition-all hover:-translate-y-1 cursor-pointer border border-slate-200 flex flex-col h-full"
         onclick="openArticle('${escapeHtml(String(art.id))}')">
      <div class="flex gap-2 mb-5">
        ${(art.tags || []).slice(0, 2).map(t =>
          `<span class="bg-indigo-50 text-brand-purple text-[10px] px-2 py-1 rounded font-black uppercase tracking-wider">${escapeHtml(t)}</span>`
        ).join('')}
        ${(art.tags?.length > 2) ? `<span class="text-slate-400 text-xs font-bold px-1 py-1">...</span>` : ''}
      </div>
      <h3 class="text-2xl font-black text-brand-navy mb-4 line-clamp-3 leading-snug">${escapeHtml(art.title)}</h3>
      <p class="text-slate-500 text-sm mb-8 flex-grow line-clamp-4">${escapeHtml(art.excerpt || '')}</p>
      <div class="border-t border-slate-100 pt-5 flex justify-between items-center text-xs font-bold text-slate-400">
        <span>${new Date(art.published_at).toLocaleDateString('pl-PL')}</span>
        <span class="text-brand-purple">Czytaj całość →</span>
      </div>
    </div>
  `).join('');
}


// =============================================================================
//  PANEL CMS ADMIN
// =============================================================================
async function loadAdminArticles() {
  if (currentRole !== 'admin') return;
  const list = document.getElementById('adminArticlesList');

  const { data, error } = await SB_CLIENT
    .from('aura_articles')
    .select('*')
    .order('created_at', { ascending: false });

  if (error || !data) {
    list.innerHTML = `<div class="text-red-500 p-4">Błąd bazy: ${escapeHtml(error?.message || '')}</div>`;
    return;
  }

  if (data.length === 0) {
    list.innerHTML = `
      <div class="text-center text-slate-400 py-10 text-sm border-2 border-dashed border-slate-100 rounded-2xl">
        Nie napisałeś jeszcze żadnego artykułu.
      </div>`;
    return;
  }

  list.innerHTML = data.map(art => {
    const isDraft = art.status === 'draft';
    const safeId  = escapeHtml(String(art.id));

    const statusBadge = isDraft
      ? `<span class="bg-slate-100 text-slate-600 text-[10px] font-black uppercase px-2.5 py-1 rounded">Szkic</span>`
      : `<span class="bg-emerald-100 text-emerald-700 text-[10px] font-black uppercase px-2.5 py-1 rounded">Opublikowano</span>`;

    const platBadges = (art.platforms || ['AuraBenefits']).map(p => {
      const map = {
        'Grupowe.pro':       'bg-blue-100 text-blue-700',
        'UtrataDochodu.pl':  'bg-teal-100 text-teal-700',
        'AuraConsulting.pl': 'bg-amber-100 text-amber-700',
      };
      const cls = map[p] || 'bg-purple-100 text-brand-purple';
      return `<span class="${cls} text-[9px] px-1.5 py-0.5 rounded font-bold uppercase">${escapeHtml(p)}</span>`;
    }).join(' ');

    return `
      <div class="bg-slate-50 border border-slate-200 p-6 rounded-3xl flex flex-col xl:flex-row justify-between lg:items-center gap-6 hover:border-brand-purple/40 transition-colors">
        <div class="flex-grow">
          <div class="flex items-center gap-3 mb-2 flex-wrap">
            ${statusBadge}
            <span class="text-slate-300">|</span>
            ${platBadges}
            <span class="text-xs text-slate-400 ml-auto">${new Date(art.created_at).toLocaleDateString('pl-PL')}</span>
          </div>
          <h4 class="font-bold text-brand-navy text-xl leading-snug">${escapeHtml(art.title)}</h4>
          <p class="text-sm text-slate-500 mt-2 line-clamp-1">${escapeHtml(art.excerpt || 'Brak zajawki...')}</p>
        </div>
        <div class="flex flex-wrap gap-2 shrink-0">
          <button onclick="openArticle('${safeId}')"
                  class="bg-white border border-slate-200 hover:bg-slate-100 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs shadow-sm transition-colors">
            Podgląd
          </button>
          <button onclick="editArticleInCms('${safeId}')"
                  class="bg-brand-purple/10 hover:bg-brand-purple/20 text-brand-purple font-bold px-4 py-2.5 rounded-xl text-xs transition-colors">
            ✏️ Edytuj
          </button>
          ${!isDraft
            ? `<button onclick="unpublishArticle('${safeId}')"
                       class="bg-slate-200 hover:bg-slate-300 text-slate-700 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors">
                 Cofnij publikację
               </button>`
            : ''}
          <button onclick="deleteArticle('${safeId}')"
                  class="bg-red-50 hover:bg-red-100 text-red-600 font-bold px-4 py-2.5 rounded-xl text-xs transition-colors">
            Usuń
          </button>
        </div>
      </div>`;
  }).join('');
}

function openNewArticleModal() {
  if (currentRole !== 'admin') return;
  document.getElementById('cmsModalTitle').textContent = 'Tworzenie Nowego Artykułu';
  document.getElementById('cmsId').value      = '';
  document.getElementById('cmsTitle').value   = '';
  document.getElementById('cmsExcerpt').value = '';
  document.getElementById('cmsTags').value    = '';
  document.getElementById('plat_aurabenefits').checked  = true;
  document.getElementById('plat_grupowe').checked        = false;
  document.getElementById('plat_utratadochodu').checked  = false;
  document.getElementById('plat_auraconsulting').checked = false;
  quillInstance.root.innerHTML = '';
  document.getElementById('cmsModal').classList.remove('hidden');
  document.getElementById('cmsModal').classList.add('flex');
}

async function editArticleInCms(id) {
  if (currentRole !== 'admin') return;
  const { data } = await SB_CLIENT.from('aura_articles').select('*').eq('id', id).single();
  if (!data) return;

  document.getElementById('cmsModalTitle').textContent = 'Edycja Artykułu';
  document.getElementById('cmsId').value      = id;
  document.getElementById('cmsTitle').value   = data.title;
  document.getElementById('cmsExcerpt').value = data.excerpt || '';
  document.getElementById('cmsTags').value    = (data.tags || []).join(', ');

  const platforms = data.platforms || ['AuraBenefits'];
  document.getElementById('plat_aurabenefits').checked  = platforms.includes('AuraBenefits');
  document.getElementById('plat_grupowe').checked        = platforms.includes('Grupowe.pro');
  document.getElementById('plat_utratadochodu').checked  = platforms.includes('UtrataDochodu.pl');
  document.getElementById('plat_auraconsulting').checked = platforms.includes('AuraConsulting.pl');

  quillInstance.root.innerHTML = data.content;
  document.getElementById('cmsModal').classList.remove('hidden');
  document.getElementById('cmsModal').classList.add('flex');
}

function closeCmsModal() {
  document.getElementById('cmsModal').classList.add('hidden');
  document.getElementById('cmsModal').classList.remove('flex');
}

async function saveArticle(desiredStatus) {
  if (currentRole !== 'admin') { alert('Brak uprawnień.'); return; }

  const id          = document.getElementById('cmsId').value;
  const title       = document.getElementById('cmsTitle').value.trim();
  const excerpt     = document.getElementById('cmsExcerpt').value.trim();
  const tagsStr     = document.getElementById('cmsTags').value.trim();
  const contentHtml = quillInstance.root.innerHTML;

  const platforms = [];
  if (document.getElementById('plat_aurabenefits').checked)  platforms.push('AuraBenefits');
  if (document.getElementById('plat_grupowe').checked)       platforms.push('Grupowe.pro');
  if (document.getElementById('plat_utratadochodu').checked) platforms.push('UtrataDochodu.pl');
  if (document.getElementById('plat_auraconsulting').checked) platforms.push('AuraConsulting.pl');

  if (!platforms.length)             return alert('Wybierz przynajmniej jedno miejsce publikacji.');
  if (!title)                        return alert('Podaj tytuł artykułu.');
  if (contentHtml === '<p><br></p>') return alert('Artykuł nie może być pusty.');

  const tags = tagsStr ? tagsStr.split(',').map(t => t.trim()).filter(Boolean) : [];

  const payload = {
    title, excerpt, content: contentHtml,
    tags, platforms,
    status: desiredStatus,
    ai_generated: false
  };
  if (desiredStatus === 'published') payload.published_at = new Date().toISOString();

  const { error } = id
    ? await SB_CLIENT.from('aura_articles').update(payload).eq('id', id)
    : await SB_CLIENT.from('aura_articles').insert([payload]);

  if (!error) {
    closeCmsModal();
    loadAdminArticles();
    if (desiredStatus === 'published') { alert('Artykuł opublikowany!'); switchTab('blog'); }
    else alert('Szkic zapisany.');
  } else {
    alert('Błąd zapisu: ' + error.message);
  }
}

async function unpublishArticle(id) {
  if (currentRole !== 'admin') return;
  await SB_CLIENT.from('aura_articles').update({ status: 'draft' }).eq('id', id);
  loadAdminArticles();
}

async function deleteArticle(id) {
  if (currentRole !== 'admin') return;
  if (!confirm('Na pewno usunąć ten artykuł bezpowrotnie?')) return;
  await SB_CLIENT.from('aura_articles').delete().eq('id', id);
  loadAdminArticles();
}


// =============================================================================
//  INIT
// =============================================================================
window.onload = async () => {
  initQuill();
  await checkAuthAndUpdateUI();
  handleHashChange();
};
