const grid = document.querySelector('#episode-grid');
const categoryFilter = document.querySelector('#category-filter');
const episodeCategory = document.querySelector('#episode-category');
const searchInput = document.querySelector('#search-input');
const libraryMessage = document.querySelector('#library-message');
const libraryCount = document.querySelector('#library-count');
const dialog = document.querySelector('#admin-dialog');
const adminMessage = document.querySelector('#admin-message');
const adminKeyInput = document.querySelector('#admin-key');
const adminList = document.querySelector('#admin-list');
const episodeForm = document.querySelector('#episode-form');
const categoryForm = document.querySelector('#category-form');
let episodes = [];
let categories = [];
let activeTab = 'episode';
let searchTimer;

async function api(url, options = {}) {
  const headers = new Headers(options.headers || {});
  const key = sessionStorage.getItem('adminKey');
  if (key) headers.set('X-Admin-Key', key);
  const response = await fetch(url, { ...options, headers });
  if (response.status === 204) return null;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Yêu cầu thất bại (${response.status}).`);
  return data;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function showMessage(element, text, error = true) {
  element.textContent = text;
  element.classList.toggle('success-message', !error);
}

function renderEpisodes() {
  grid.replaceChildren();
  libraryCount.textContent = `${episodes.length} ${episodes.length === 1 ? 'tập podcast' : 'tập podcast'}`;
  if (!episodes.length) {
    const empty = document.createElement('div');
    empty.className = 'empty-state';
    empty.innerHTML = '<strong>Chưa có tập podcast phù hợp.</strong>Hãy thử đổi từ khóa hoặc danh mục, hoặc thêm tập mới trong mục Quản trị.';
    grid.append(empty);
    return;
  }
  episodes.forEach((episode, index) => {
    const card = document.createElement('article');
    card.className = 'episode-card';
    card.innerHTML = `
      <div class="card-art">
        <span class="card-number">EP. ${String(index + 1).padStart(2, '0')}</span>
        <span class="category-pill">${escapeHtml(episode.categoryName)}</span>
        <span class="card-note">listen<br>closely.</span>
      </div>
      <div class="card-content">
        <h3>${escapeHtml(episode.title)}</h3>
        <p class="card-description">${escapeHtml(episode.description || 'Một câu chuyện đang chờ bạn khám phá.')}</p>
        ${episode.audioFile ? `<audio preload="none" src="/api/media/${encodeURIComponent(episode.audioFile)}"></audio>` : ''}
        <div class="card-footer">
          <span class="host-label">${escapeHtml(episode.host || 'Podcast Library')}</span>
          <button class="play-button" type="button" ${episode.audioFile ? '' : 'disabled'} aria-label="${episode.audioFile ? 'Nghe thử' : 'Chưa có tệp âm thanh'}">${episode.audioFile ? '▶' : '—'}</button>
        </div>
      </div>`;
    const audio = card.querySelector('audio');
    const playButton = card.querySelector('.play-button');
    if (audio) {
      playButton.addEventListener('click', async () => {
        for (const otherAudio of document.querySelectorAll('.episode-card audio')) {
          if (otherAudio !== audio) {
            otherAudio.pause();
            otherAudio.nextElementSibling?.querySelector('.play-button')?.replaceChildren(document.createTextNode('▶'));
          }
        }
        if (audio.paused) {
          try {
            await audio.play();
            playButton.textContent = 'Ⅱ';
          } catch (error) {
            showMessage(libraryMessage, `Không thể phát tệp âm thanh: ${error.message}`);
          }
        } else {
          audio.pause();
          playButton.textContent = '▶';
        }
      });
      audio.addEventListener('ended', () => { playButton.textContent = '▶'; });
    }
    grid.append(card);
  });
}

async function loadCategories() {
  categories = await api('/api/categories');
  const currentFilter = categoryFilter.value;
  categoryFilter.replaceChildren(new Option('Tất cả danh mục', ''));
  episodeCategory.replaceChildren();
  categories.forEach((category) => {
    categoryFilter.add(new Option(category.name, String(category.id)));
    episodeCategory.add(new Option(category.name, String(category.id)));
  });
  categoryFilter.value = categories.some((category) => String(category.id) === currentFilter) ? currentFilter : '';
}

async function loadEpisodes() {
  libraryMessage.textContent = '';
  const params = new URLSearchParams();
  if (categoryFilter.value) params.set('category', categoryFilter.value);
  if (searchInput.value.trim()) params.set('q', searchInput.value.trim());
  try {
    episodes = await api(`/api/episodes?${params}`);
    renderEpisodes();
  } catch (error) {
    showMessage(libraryMessage, error.message);
    libraryCount.textContent = 'Không thể tải thư viện';
  }
}

async function loadAdminList() {
  adminList.replaceChildren();
  const entries = activeTab === 'episode' ? episodes : categories;
  entries.forEach((entry) => {
    const item = document.createElement('li');
    const title = document.createElement('span');
    title.className = 'admin-item-title';
    title.textContent = activeTab === 'episode' ? entry.title : entry.name;
    const actions = document.createElement('span');
    actions.className = 'admin-item-actions';
    if (activeTab === 'episode') {
      const edit = document.createElement('button');
      edit.className = 'small-button';
      edit.type = 'button';
      edit.textContent = 'Sửa';
      edit.addEventListener('click', () => {
        document.querySelector('#episode-id').value = entry.id;
        episodeForm.elements.title.value = entry.title;
        episodeForm.elements.host.value = entry.host;
        episodeForm.elements.categoryId.value = entry.categoryId;
        episodeForm.elements.description.value = entry.description;
        document.querySelector('#episode-submit').textContent = 'Cập nhật tập podcast';
        episodeForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actions.append(edit);
    } else {
      const edit = document.createElement('button');
      edit.className = 'small-button';
      edit.type = 'button';
      edit.textContent = 'Sửa';
      edit.addEventListener('click', () => {
        document.querySelector('#category-id').value = entry.id;
        categoryForm.elements.name.value = entry.name;
        categoryForm.elements.description.value = entry.description;
        document.querySelector('#category-submit').textContent = 'Cập nhật danh mục';
        categoryForm.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
      actions.append(edit);
    }
    const remove = document.createElement('button');
    remove.className = 'small-button danger';
    remove.type = 'button';
    remove.textContent = 'Xóa';
    remove.addEventListener('click', async () => {
      const label = activeTab === 'episode' ? 'tập podcast' : 'danh mục';
      if (!window.confirm(`Bạn có chắc muốn xóa ${label} này?`)) return;
      try {
        await api(`/api/admin/${activeTab === 'episode' ? 'episodes' : 'categories'}/${entry.id}`, { method: 'DELETE' });
        await refreshLibrary();
        showMessage(adminMessage, `Đã xóa ${label}.`, false);
        loadAdminList();
      } catch (error) {
        showMessage(adminMessage, error.message);
      }
    });
    actions.append(remove);
    item.append(title, actions);
    adminList.append(item);
  });
}

async function refreshLibrary() {
  await loadCategories();
  await loadEpisodes();
  if (dialog.open) loadAdminList();
}

document.querySelector('#admin-open').addEventListener('click', async () => {
  adminKeyInput.value = sessionStorage.getItem('adminKey') || '';
  dialog.showModal();
  try {
    await refreshLibrary();
    loadAdminList();
  } catch (error) {
    showMessage(adminMessage, error.message);
  }
});
document.querySelector('#admin-close').addEventListener('click', () => dialog.close());
dialog.addEventListener('click', (event) => {
  if (event.target === dialog) dialog.close();
});
adminKeyInput.addEventListener('change', () => {
  sessionStorage.setItem('adminKey', adminKeyInput.value);
});
document.querySelectorAll('.tab-button').forEach((button) => button.addEventListener('click', () => {
  activeTab = button.dataset.tab;
  document.querySelectorAll('.tab-button').forEach((tab) => tab.classList.toggle('active', tab === button));
  episodeForm.classList.toggle('hidden', activeTab !== 'episode');
  categoryForm.classList.toggle('hidden', activeTab !== 'category');
  loadAdminList();
}));
episodeForm.addEventListener('reset', () => {
  document.querySelector('#episode-id').value = '';
  document.querySelector('#episode-submit').textContent = 'Lưu tập podcast';
});
categoryForm.addEventListener('reset', () => {
  document.querySelector('#category-id').value = '';
  document.querySelector('#category-submit').textContent = 'Thêm danh mục';
});
episodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionStorage.setItem('adminKey', adminKeyInput.value);
  const id = document.querySelector('#episode-id').value;
  const formData = new FormData(episodeForm);
  if (!formData.get('audio')?.size) formData.delete('audio');
  try {
    await api(`/api/admin/episodes${id ? `/${id}` : ''}`, { method: id ? 'PUT' : 'POST', body: formData });
    episodeForm.reset();
    await refreshLibrary();
    showMessage(adminMessage, id ? 'Đã cập nhật tập podcast.' : 'Đã thêm tập podcast.', false);
  } catch (error) {
    showMessage(adminMessage, error.message);
  }
});
categoryForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  sessionStorage.setItem('adminKey', adminKeyInput.value);
  const formData = new FormData(categoryForm);
  const id = document.querySelector('#category-id').value;
  try {
    await api(`/api/admin/categories${id ? `/${id}` : ''}`, {
      method: id ? 'PUT' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: formData.get('name'), description: formData.get('description') })
    });
    categoryForm.reset();
    await refreshLibrary();
    showMessage(adminMessage, id ? 'Đã cập nhật danh mục.' : 'Đã thêm danh mục.', false);
  } catch (error) {
    showMessage(adminMessage, error.message);
  }
});
categoryFilter.addEventListener('change', loadEpisodes);
searchInput.addEventListener('input', () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(loadEpisodes, 250);
});

refreshLibrary().catch((error) => showMessage(libraryMessage, error.message));
