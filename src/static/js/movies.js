/**
 * Media Admin - Movies (list/detail, add/preview modals, pagination, metadata refresh, rename)
 */

let currentMoviesView = getUiPref('moviesViewMode', 'cards');

let movieRefreshPollInterval = null;
let movieRefreshWasPolling = false;

const MOVIE_POSTER_PLACEHOLDER = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23252542%22 width=%22100%22 height=%22150%22/></svg>";

// ── View Mode ────────────────────────────────────────────────────

function setMoviesView(view) {
    currentMoviesView = view;
    setUiPref('moviesViewMode', view);

    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.view-btn[onclick="setMoviesView('${view}')"]`)?.classList.add('active');

    // Toggle list controls enabled/disabled
    const listControls = document.getElementById('movies-list-controls');
    if (listControls) {
        listControls.querySelectorAll('.card-control-btn').forEach(btn => {
            btn.disabled = (view !== 'list');
        });
    }

    // Re-render movies container
    const container = document.getElementById('movies-container');
    if (container && state.movies) {
        container.innerHTML = renderMoviesView(state.movies);
    }
}

// ── Render Helpers ───────────────────────────────────────────────

function renderMoviesView(movies) {
    if (movies.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">🎬</div>
                <h3>No Movies Yet</h3>
                <p>Add your first movie to get started.</p>
                <button class="btn btn-primary mt-20" onclick="showAddMovieModal()">Add Movie</button>
            </div>
        `;
    }

    switch (currentMoviesView) {
        case 'compact':
            return `<div class="shows-grid tiles">${movies.map(movie => renderMovieCardCompact(movie)).join('')}</div>`;
        case 'list':
            return `<div class="shows-list">${movies.map(movie => renderMovieListItem(movie)).join('')}</div>`;
        case 'cards':
        default:
            return `<div class="shows-grid">${movies.map(movie => renderMovieCard(movie)).join('')}</div>`;
    }
}

function getMovieFileStatusBadge(movie) {
    if (movie.file_status === 'found') {
        return '<span class="badge badge-success badge-sm">Found</span>';
    } else if (movie.file_status === 'renamed') {
        return '<span class="badge badge-info badge-sm">Renamed</span>';
    } else {
        return '<span class="badge badge-danger badge-sm">Missing</span>';
    }
}

function renderMovieCard(movie) {
    const posterUrl = movie.poster_path
        ? getImageUrl(movie.poster_path)
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%23252542" width="100" height="150"/><text x="50" y="75" text-anchor="middle" fill="%23666" font-size="12">No Poster</text></svg>';

    const year = movie.year || 'N/A';
    const runtime = movie.runtime ? `${movie.runtime} min` : '';
    const rating = movie.vote_average ? movie.vote_average.toFixed(1) : '';
    const statusClass = movie.file_status === 'found' ? 'continuing' :
                        movie.file_status === 'renamed' ? 'continuing' : 'ended';

    return `
        <div class="show-card" onclick="showMovieDetail(${movie.id})">
            <img src="${posterUrl}" alt="${escapeHtml(movie.title)}" class="show-poster" onerror="this.src='${MOVIE_POSTER_PLACEHOLDER}'">
            <div class="show-tile-overlay ${statusClass}">
                <div class="show-tile-name">${escapeHtml(movie.title)}</div>
                <div class="show-tile-year">${year}</div>
                <div class="show-tile-details">
                    ${runtime ? `<span>${runtime}</span>` : ''}
                    ${rating ? `<span>${rating} / 10</span>` : ''}
                    ${getMovieFileStatusBadge(movie)}
                </div>
                ${movie.collection_name ? `<div class="show-tile-status continuing">${escapeHtml(movie.collection_name)}</div>` : ''}
            </div>
        </div>
    `;
}

function renderMovieCardCompact(movie) {
    const posterUrl = movie.poster_path
        ? getImageUrl(movie.poster_path)
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%23252542" width="100" height="150"/></svg>';

    const year = movie.year || 'N/A';
    const statusClass = movie.file_status === 'found' || movie.file_status === 'renamed' ? 'continuing' : 'ended';

    return `
        <div class="show-tile" onclick="showMovieDetail(${movie.id})">
            <img src="${posterUrl}" alt="${escapeHtml(movie.title)}" class="show-tile-poster" onerror="this.src='${MOVIE_POSTER_PLACEHOLDER}'">
            <div class="show-tile-overlay ${statusClass}">
                <div class="show-tile-name">${escapeHtml(movie.title)}</div>
                <div class="show-tile-year">${year}</div>
                ${getMovieFileStatusBadge(movie)}
            </div>
        </div>
    `;
}

function getMovieListExpandDefault() {
    const v = getUiPref('moviesListExpandDefault', false);
    return v === true || v === 'true';
}

function getMovieListExpandOverrides() {
    return getUiPref('moviesListExpandOverrides', {});
}

function isMovieListItemExpanded(movieId) {
    const overrides = getMovieListExpandOverrides();
    if (movieId in overrides) return overrides[movieId];
    return getMovieListExpandDefault();
}

function setMovieListExpandState(movieId, expanded) {
    const overrides = getMovieListExpandOverrides();
    const defaultState = getMovieListExpandDefault();
    if (expanded === defaultState) {
        delete overrides[movieId];
    } else {
        overrides[movieId] = expanded;
    }
    setUiPref('moviesListExpandOverrides', overrides);
}

function renderMovieListItem(movie) {
    const year = movie.year || 'N/A';
    const runtime = movie.runtime ? `${movie.runtime} min` : '';
    const isExpanded = isMovieListItemExpanded(movie.id);

    return `
        <div class="show-list-item" id="movie-list-item-${movie.id}">
            <div class="show-list-header" onclick="toggleMovieListItem(${movie.id})">
                <img src="${isExpanded ? '/static/images/show-collapse.png' : '/static/images/show-expand.png'}" class="show-list-chevron-img" id="movie-list-chevron-${movie.id}" alt="">
                <span class="show-list-name">${escapeHtml(movie.title)}</span>
                <span class="show-list-status">
                    <span class="text-muted">${year}${runtime ? ` - ${runtime}` : ''}</span>
                    ${getMovieFileStatusBadge(movie)}
                </span>
            </div>
            <div class="show-list-details ${isExpanded ? 'open' : ''}" id="movie-list-details-${movie.id}">
                <div class="show-list-details-content">
                    <p class="text-muted mb-10">${escapeHtml((movie.overview || 'No description available.').substring(0, 200))}${(movie.overview || '').length > 200 ? '...' : ''}</p>
                    <div class="show-list-meta">
                        ${movie.file_path ? `<span><strong>Folder:</strong> ${escapeHtml(movie.file_path.substring(0, movie.file_path.lastIndexOf('/')))}</span>` : ''}
                        ${movie.file_path ? `<span><strong>File:</strong> ${escapeHtml(movie.file_path.substring(movie.file_path.lastIndexOf('/') + 1))}</span>` : ''}
                    </div>
                    <button class="btn btn-sm btn-primary mt-10" onclick="event.stopPropagation(); showMovieDetail(${movie.id})">View Details</button>
                </div>
            </div>
        </div>
    `;
}

function toggleMovieListItem(movieId) {
    const details = document.getElementById(`movie-list-details-${movieId}`);
    const chevron = document.getElementById(`movie-list-chevron-${movieId}`);

    if (!details) return;

    const isOpen = details.classList.contains('open');

    details.classList.toggle('open');
    if (chevron) {
        chevron.src = isOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    }

    setMovieListExpandState(movieId, !isOpen);
}

function collapseAllMovieListItems() {
    setUiPref('moviesListExpandDefault', false);
    setUiPref('moviesListExpandOverrides', {});
    document.querySelectorAll('.show-list-item[id^="movie-list-item-"]').forEach(item => {
        const movieId = item.id.replace('movie-list-item-', '');
        const details = document.getElementById(`movie-list-details-${movieId}`);
        const chevron = document.getElementById(`movie-list-chevron-${movieId}`);
        if (details) details.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
    });
}

function expandAllMovieListItems() {
    setUiPref('moviesListExpandDefault', true);
    setUiPref('moviesListExpandOverrides', {});
    document.querySelectorAll('.show-list-item[id^="movie-list-item-"]').forEach(item => {
        const movieId = item.id.replace('movie-list-item-', '');
        const details = document.getElementById(`movie-list-details-${movieId}`);
        const chevron = document.getElementById(`movie-list-chevron-${movieId}`);
        if (details) details.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
    });
}

// ── Movies List Page ─────────────────────────────────────────────

async function renderMoviesList() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        // Load settings to get movies_per_page if not already loaded
        if (!state.settings) {
            state.settings = await api('/settings');
        }
        state.moviesPerPage = state.settings.movies_per_page ?? 0;

        const resp = await api(`/movies?page=${state.moviesPage}&per_page=${state.moviesPerPage}`);
        const movies = resp.movies;
        state.movies = movies;
        state.totalMovies = resp.total;
        state.moviesPageLabels = resp.page_labels || [];
        state.moviesTotalPages = resp.total_pages || 1;

        const totalPages = state.moviesTotalPages;
        // Clamp current page
        if (state.moviesPage > totalPages && totalPages > 0) {
            state.moviesPage = totalPages;
            return renderMoviesList();
        }

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Movies</h1>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <div class="view-toggle">
                        <button class="view-btn ${currentMoviesView === 'cards' ? 'active' : ''}" onclick="setMoviesView('cards')" title="Card View">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                        </button>
                        <button class="view-btn ${currentMoviesView === 'compact' ? 'active' : ''}" onclick="setMoviesView('compact')" title="Tiles">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="4" rx="1"/><rect x="6" y="1" width="4" height="4" rx="1"/><rect x="11" y="1" width="4" height="4" rx="1"/><rect x="1" y="6" width="4" height="4" rx="1"/><rect x="6" y="6" width="4" height="4" rx="1"/><rect x="11" y="6" width="4" height="4" rx="1"/><rect x="1" y="11" width="4" height="4" rx="1"/><rect x="6" y="11" width="4" height="4" rx="1"/><rect x="11" y="11" width="4" height="4" rx="1"/></svg>
                        </button>
                        <button class="view-btn ${currentMoviesView === 'list' ? 'active' : ''}" onclick="setMoviesView('list')" title="List View">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/></svg>
                        </button>
                    </div>
                    <div class="card-control-btns" id="movies-list-controls">
                        <button class="card-control-btn" onclick="collapseAllMovieListItems()" title="Collapse all" ${currentMoviesView !== 'list' ? 'disabled' : ''}><img src="/static/images/collapse.png" alt="Collapse"></button>
                        <button class="card-control-btn" onclick="expandAllMovieListItems()" title="Expand all" ${currentMoviesView !== 'list' ? 'disabled' : ''}><img src="/static/images/expand.png" alt="Expand"></button>
                    </div>
                    <button class="btn btn-secondary" onclick="refreshAllMovies()" id="movie-refresh-all-btn">Refresh All Metadata</button>
                    <button class="btn btn-secondary" onclick="startMovieSlowImport()">Managed Import</button>
                    <button class="btn btn-primary" onclick="showAddMovieModal()">+ Add Movie</button>
                </div>
            </div>

            <div id="movie-refresh-progress-container" style="display: none;">
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h2 class="card-title">Refreshing Metadata</h2>
                        <span id="movie-refresh-progress-text" class="text-muted">0/0</span>
                    </div>
                    <div style="padding: 15px;">
                        <div class="progress-bar-container">
                            <div class="progress-bar" id="movie-refresh-progress-bar" style="width: 0%"></div>
                        </div>
                        <p id="movie-refresh-current-movie" class="text-muted" style="margin-top: 10px; font-size: 0.9rem;"></p>
                    </div>
                </div>
            </div>

            ${renderMoviesPagination(state.moviesPage, totalPages, state.moviesPageLabels)}

            <div class="card">
                <div id="movies-container">
                    ${renderMoviesView(movies)}
                </div>
            </div>

            ${renderMoviesPagination(state.moviesPage, totalPages, state.moviesPageLabels)}
        `;

        // Check if refresh is in progress on page load
        checkMovieRefreshStatus();
        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load movies.</div>`;
    }
}

// ── Pagination ───────────────────────────────────────────────────

function renderMoviesPerPageSelect() {
    const val = state.moviesPerPage || 0;
    const opts = (state.settings?.movies_per_page_options || [100, 300, 500, 1000, 1500])
        .map(v => [v, String(v)]);
    opts.push([0, 'All']);
    return `<select class="shows-per-page-select" onchange="changeMoviesPerPage(this.value)">
        ${opts.map(([v, l]) =>
            `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`
        ).join('')}
    </select>`;
}

function renderMoviesPagination(currentPage, totalPages, pageLabels) {
    const perPageSelect = renderMoviesPerPageSelect();

    if (totalPages <= 1) {
        return `<div class="pagination">${perPageSelect}</div>`;
    }

    let pageButtons = '';
    for (let i = 1; i <= totalPages; i++) {
        const label = pageLabels && pageLabels[i - 1] ? pageLabels[i - 1] : i;
        pageButtons += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goToMoviesPage(${i})">${label}</button>`;
    }

    return `
        <div class="pagination">
            <button class="pagination-btn" onclick="goToMoviesPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            ${pageButtons}
            <button class="pagination-btn" onclick="goToMoviesPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
            ${perPageSelect}
        </div>
    `;
}

async function changeMoviesPerPage(value) {
    const newVal = parseInt(value);
    state.moviesPerPage = newVal;
    state.moviesPage = 1;

    // Save to backend
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ movies_per_page: newVal })
        });
        if (state.settings) state.settings.movies_per_page = newVal;
    } catch (error) {
        // Continue with re-render even if save fails
    }

    renderMoviesList();
}

function goToMoviesPage(page) {
    const totalPages = state.moviesTotalPages || 1;
    if (page < 1 || page > totalPages) return;
    state.moviesPage = page;
    window.scrollTo(0, 0);
    renderMoviesList();
}

// ── Managed Import (Movies) ──────────────────────────────────────

let _lastMovieImportStatus = null;

async function startMovieSlowImport() {
    try {
        const [settings, folders] = await Promise.all([
            api('/settings'),
            api('/folders')
        ]);

        const slowImportCount = settings.slow_import_count || 10;
        const movieFolders = folders.filter(f => f.type === 'movie_library' && f.enabled);

        if (movieFolders.length === 0) {
            showToast('No movie library folders configured. Add one in Settings.', 'warning');
            return;
        }

        const folder = movieFolders[0];
        showMovieSlowImportModal(folder.path);

        await api('/scan/movie-library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_id: folder.id, limit: slowImportCount })
        });

        pollMovieSlowImportStatus();
    } catch (error) {
        closeMovieSlowImportModal();
    }
}

function showMovieSlowImportModal(folderPath) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Movie Managed Import';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-header">
                <div class="library-scan-folder" title="${escapeHtml(folderPath)}">${escapeHtml(folderPath)}</div>
                <div class="library-scan-status">
                    <div class="library-scan-spinner"></div>
                    <span id="movie-import-message">Initializing...</span>
                </div>
                <div class="library-scan-progress-container">
                    <div class="library-scan-progress-bar" id="movie-import-progress" style="width: 0%"></div>
                </div>
            </div>
            <div class="library-scan-stats" id="movie-import-stats">
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="movie-stat-added">0</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="movie-stat-skipped">0</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="movie-stat-errors">0</span>
                    <span class="library-scan-stat-label">Errors</span>
                </div>
            </div>
        </div>
    `;

    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');
}

function updateMovieSlowImportModal(status) {
    const messageEl = document.getElementById('movie-import-message');
    if (messageEl) messageEl.textContent = status.message || 'Discovering...';

    const progressEl = document.getElementById('movie-import-progress');
    if (progressEl) progressEl.style.width = `${status.progress || 0}%`;

    const discovered = status.discovered || [];
    const added = discovered.filter(d => d.status === 'added').length;
    const skipped = discovered.filter(d => d.status === 'existing' || d.status === 'not_found').length;
    const errors = discovered.filter(d => d.status === 'error').length;

    const statAdded = document.getElementById('movie-stat-added');
    const statSkipped = document.getElementById('movie-stat-skipped');
    const statErrors = document.getElementById('movie-stat-errors');
    if (statAdded) statAdded.textContent = added;
    if (statSkipped) statSkipped.textContent = skipped;
    if (statErrors) statErrors.textContent = errors;
}

function closeMovieSlowImportModal() {
    document.querySelector('.modal-close').style.display = '';
    closeModal();
}

function showMovieImportComplete(status) {
    _lastMovieImportStatus = status;
    _renderMovieImportCompleteModal(status);
    const indicator = document.getElementById('movie-import-results-indicator');
    if (indicator) indicator.remove();
    // Refresh movie list in the background so it's up to date
    renderMoviesList();
}

function _renderMovieImportCompleteModal(status) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const result = status.result || {};
    const discovered = status.discovered || [];

    const statusDisplay = (item) => {
        switch (item.status) {
            case 'added': return { icon: '✓', cls: 'console-success', label: 'Added' };
            case 'existing': return { icon: '→', cls: 'console-skip', label: 'Existing' };
            case 'not_found': return { icon: '⚠', cls: 'console-warning', label: 'Not Found' };
            case 'error': return { icon: '✗', cls: 'console-error', label: item.error || 'Error' };
            default: return { icon: '•', cls: 'console-info', label: item.status };
        }
    };

    modalTitle.textContent = 'Import Complete';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-complete-stats">
                <div class="library-scan-stat ${result.added > 0 ? 'stat-highlight' : ''}">
                    <span class="library-scan-stat-value">${result.added || 0}</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value">${result.skipped || 0}</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value">${result.errors || 0}</span>
                    <span class="library-scan-stat-label">Errors</span>
                </div>
            </div>
            ${discovered.length > 0 ? `
                <div class="table-container" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px;">
                    <table style="font-size: 0.85rem;">
                        <thead>
                            <tr>
                                <th style="width: 30px;"></th>
                                <th>Movie</th>
                                <th>Filename</th>
                                <th>Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${discovered.map(item => {
                                const sd = statusDisplay(item);
                                const displayTitle = item.title ? `${escapeHtml(item.title)}${item.year ? ' (' + item.year + ')' : ''}` : '—';
                                return `<tr>
                                    <td class="${sd.cls}" style="text-align: center; font-weight: bold;">${sd.icon}</td>
                                    <td>${displayTitle}</td>
                                    <td class="text-muted" style="font-size: 0.8rem;" title="${escapeHtml(item.filename)}">${escapeHtml(item.filename)}</td>
                                    <td class="text-muted" style="font-size: 0.8rem;">${escapeHtml(sd.label)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            <div class="library-scan-actions">
                <button class="btn btn-primary" onclick="continueMovieImport();">Continue Import</button>
                <button class="btn btn-primary" onclick="closeModal(); renderMoviesList();">View Movies</button>
                <button class="btn btn-secondary" onclick="minimizeMovieImportResults();">Minimize</button>
                <button class="btn btn-secondary" onclick="dismissMovieImportResults(); closeModal(); renderMoviesList();">Close</button>
            </div>
        </div>
    `;

    document.querySelector('.modal-close').style.display = '';
    modal.classList.add('active');
    modal.classList.add('modal-wide');
}

function minimizeMovieImportResults() {
    closeModal();
    renderMoviesList();

    if (document.getElementById('movie-import-results-indicator')) return;

    const nav = document.querySelector('.nav-menu');
    const li = document.createElement('li');
    li.id = 'movie-import-results-indicator';
    li.innerHTML = `
        <a href="#" onclick="restoreMovieImportResults(); return false;" style="color: var(--success-color);">
            <img src="/static/images/minimized-window.png" class="nav-icon-img" alt="">
            Movie Import Results
        </a>
    `;
    nav.appendChild(li);
}

function restoreMovieImportResults() {
    if (_lastMovieImportStatus) {
        _renderMovieImportCompleteModal(_lastMovieImportStatus);
    }
}

function dismissMovieImportResults() {
    _lastMovieImportStatus = null;
    const indicator = document.getElementById('movie-import-results-indicator');
    if (indicator) indicator.remove();
}

async function continueMovieImport() {
    closeModal();
    dismissMovieImportResults();
    startMovieSlowImport();
}

function pollMovieSlowImportStatus() {
    const checkStatus = async () => {
        try {
            const status = await fetch(`${API_BASE}/scan/movie-library-folder/status`).then(r => r.json());

            if (status.running) {
                updateMovieSlowImportModal(status);
                setTimeout(checkStatus, 500);
            } else {
                updateMovieSlowImportModal(status);
                setTimeout(() => {
                    if (status.result?.error) {
                        closeMovieSlowImportModal();
                        showToast(`Import failed: ${status.result.error}`, 'error');
                    } else {
                        showMovieImportComplete(status);
                    }
                }, 1000);
            }
        } catch (error) {
            setTimeout(checkStatus, 2000);
        }
    };
    setTimeout(checkStatus, 300);
}

// ── Refresh All Metadata ─────────────────────────────────────────

async function refreshAllMovies() {
    const btn = document.getElementById('movie-refresh-all-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Starting...';
    }

    try {
        await api('/movies/refresh-all', { method: 'POST' });
        showToast('Refreshing all movie metadata...', 'info');
        startMovieRefreshPolling();
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Refresh All Metadata';
        }
    }
}

function startMovieRefreshPolling() {
    movieRefreshWasPolling = true;

    const container = document.getElementById('movie-refresh-progress-container');
    if (container) {
        container.style.display = 'block';
    }

    const btn = document.getElementById('movie-refresh-all-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    }

    // Clear any existing interval
    if (movieRefreshPollInterval) {
        clearInterval(movieRefreshPollInterval);
    }

    movieRefreshPollInterval = setInterval(async () => {
        await checkMovieRefreshStatus();
    }, 1000);
}

async function checkMovieRefreshStatus() {
    try {
        const status = await api('/movies/refresh-all/status');

        const container = document.getElementById('movie-refresh-progress-container');
        const progressBar = document.getElementById('movie-refresh-progress-bar');
        const progressText = document.getElementById('movie-refresh-progress-text');
        const currentMovie = document.getElementById('movie-refresh-current-movie');
        const btn = document.getElementById('movie-refresh-all-btn');

        if (status.running) {
            // If refresh is running, start polling if we aren't already
            if (!movieRefreshPollInterval) {
                startMovieRefreshPolling();
            }

            if (container) container.style.display = 'block';
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Refreshing...';
            }

            const percent = status.total > 0 ? (status.current / status.total) * 100 : 0;
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText) progressText.textContent = `${status.current}/${status.total}`;
            if (currentMovie) currentMovie.textContent = status.current_movie ? `Refreshing: ${status.current_movie}` : '';
        } else {
            // Refresh complete or not running
            if (movieRefreshPollInterval) {
                clearInterval(movieRefreshPollInterval);
                movieRefreshPollInterval = null;
            }

            if (container) container.style.display = 'none';
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Refresh All Metadata';
            }

            // Only show completion message if we were actively polling (not on page load)
            if (movieRefreshWasPolling && (status.completed?.length > 0 || status.errors?.length > 0)) {
                movieRefreshWasPolling = false;

                showMovieRefreshResultsModal(status);

                // Reload the movies list without triggering another status check
                const resp = await api(`/movies?page=${state.moviesPage}&per_page=${state.moviesPerPage}`);
                state.movies = resp.movies;
                state.totalMovies = resp.total;
                state.moviesTotalPages = resp.total_pages || 1;
                state.moviesPageLabels = resp.page_labels || [];
                const moviesContainer = document.getElementById('movies-container');
                if (moviesContainer) {
                    moviesContainer.innerHTML = renderMoviesView(resp.movies);
                }
            }
        }
    } catch (error) {
        // Silently fail status checks
    }
}

function showMovieRefreshResultsModal(status) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const completedCount = status.completed?.length || 0;
    const errorCount = status.errors?.length || 0;

    modalTitle.textContent = 'Movie Metadata Refresh Complete';

    let successListHtml = '';
    if (completedCount > 0) {
        successListHtml = `
            <div id="movie-refresh-success-section" class="refresh-section refresh-success" style="display: none;">
                <ul class="refresh-list">
                    ${status.completed.map(name => `
                        <li class="refresh-list-item refresh-list-success">
                            <span class="refresh-icon">✓</span>
                            <span class="refresh-text">${escapeHtml(name)}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    let errorListHtml = '';
    if (errorCount > 0) {
        errorListHtml = `
            <div id="movie-refresh-error-section" class="refresh-section refresh-errors" style="display: none;">
                <ul class="refresh-list">
                    ${status.errors.map(err => `
                        <li class="refresh-list-item refresh-list-error">
                            <span class="refresh-icon">✗</span>
                            <span class="refresh-text">${escapeHtml(err)}</span>
                        </li>
                    `).join('')}
                </ul>
            </div>
        `;
    }

    modalBody.innerHTML = `
        <div class="refresh-results">
            <div class="refresh-summary">
                <div class="refresh-stat refresh-stat-success ${completedCount > 0 ? 'clickable' : ''}" id="movie-refresh-tab-success" ${completedCount > 0 ? 'onclick="toggleMovieRefreshFilter(\'success\')"' : ''}>
                    <span class="refresh-stat-number">${completedCount}</span>
                    <span class="refresh-stat-label">Successful</span>
                </div>
                <div class="refresh-stat refresh-stat-error ${errorCount > 0 ? 'clickable' : ''}" id="movie-refresh-tab-error" ${errorCount > 0 ? 'onclick="toggleMovieRefreshFilter(\'error\')"' : ''}>
                    <span class="refresh-stat-number">${errorCount}</span>
                    <span class="refresh-stat-label">Errors</span>
                </div>
            </div>
            ${successListHtml}
            ${errorListHtml}
            <div class="refresh-actions">
                <button class="btn btn-primary" onclick="closeModal()">Close</button>
            </div>
        </div>
    `;
    modal.classList.add('active');
}

function toggleMovieRefreshFilter(filter) {
    const successSection = document.getElementById('movie-refresh-success-section');
    const errorSection = document.getElementById('movie-refresh-error-section');
    const successTab = document.getElementById('movie-refresh-tab-success');
    const errorTab = document.getElementById('movie-refresh-tab-error');

    if (filter === 'success' && successSection) {
        const isVisible = successSection.style.display !== 'none';
        successSection.style.display = isVisible ? 'none' : 'block';
        successTab.classList.toggle('active', !isVisible);
        if (errorSection) {
            errorSection.style.display = 'none';
            errorTab.classList.remove('active');
        }
    } else if (filter === 'error' && errorSection) {
        const isVisible = errorSection.style.display !== 'none';
        errorSection.style.display = isVisible ? 'none' : 'block';
        errorTab.classList.toggle('active', !isVisible);
        if (successSection) {
            successSection.style.display = 'none';
            successTab.classList.remove('active');
        }
    }
}

// ── Refresh Single Movie ─────────────────────────────────────────

async function refreshMovieMetadata(movieId) {
    try {
        await api(`/movies/${movieId}/refresh`, { method: 'POST' });
        showToast('Movie metadata refreshed', 'success');
        showMovieDetail(movieId, true);
    } catch (error) {
        // Error already shown
    }
}

// ── Delete Movie ─────────────────────────────────────────────────

function deleteMovie(movieId) {
    const movieTitle = state.currentMovie?.title || 'this movie';
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Remove Movie';
    modalBody.innerHTML = `
        <p>Are you sure you want to remove <strong>${escapeHtml(movieTitle)}</strong> from your library?</p>
        <p class="text-muted" style="font-size: 0.9rem;">This will only remove the movie from tracking. Your files will not be deleted.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="confirmDeleteMovie(${movieId})">Remove Movie</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmDeleteMovie(movieId) {
    closeModal();

    try {
        await api(`/movies/${movieId}`, { method: 'DELETE' });
        showToast('Movie removed', 'success');
        // Remove deleted movie's entries from the history stack
        state.navHistory = state.navHistory.filter(e => !(e.type === 'movie' && e.movieId === movieId));
        navigateTo('movies', false, false, false);
    } catch (error) {
        // Error already shown
    }
}

// ── Movie Detail Page ────────────────────────────────────────────

async function showMovieDetail(movieId, skipHistoryPush = false) {
    // Push current view to history before switching
    if (!skipHistoryPush) {
        pushCurrentViewToHistory();
    }

    // Update current view to movie
    state.currentView = { type: 'movie', page: 'movies', movieId: movieId, scrollY: 0 };

    // Clear active nav highlight
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    updateBackButtonVisibility();

    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const movie = await api(`/movies/${movieId}`);
        state.currentMovie = movie;

        const posterUrl = movie.poster_path ? getImageUrl(movie.poster_path) : '';
        const backdropUrl = movie.backdrop_path ? getImageUrl(movie.backdrop_path) : '';

        const year = movie.year || 'N/A';
        const runtime = movie.runtime ? `${movie.runtime} min` : 'N/A';
        const rating = movie.vote_average ? `${movie.vote_average.toFixed(1)} / 10` : 'N/A';
        const genres = Array.isArray(movie.genres) ? movie.genres.join(', ') : '';
        const studios = Array.isArray(movie.studio) ? movie.studio.join(', ') : '';

        // File status
        let fileStatusBadge;
        if (movie.file_status === 'found') {
            fileStatusBadge = '<span class="badge badge-success">Found</span>';
        } else if (movie.file_status === 'renamed') {
            fileStatusBadge = '<span class="badge badge-info">Renamed</span>';
        } else {
            fileStatusBadge = '<span class="badge badge-danger">Missing</span>';
        }

        // File size formatting
        let fileSizeStr = '';
        if (movie.file_size) {
            const gb = movie.file_size / (1024 * 1024 * 1024);
            if (gb >= 1) {
                fileSizeStr = `${gb.toFixed(2)} GB`;
            } else {
                const mb = movie.file_size / (1024 * 1024);
                fileSizeStr = `${mb.toFixed(1)} MB`;
            }
        }

        // External links
        const tmdbLink = movie.tmdb_id
            ? `<a href="https://www.themoviedb.org/movie/${movie.tmdb_id}" target="_blank" class="metadata-source-tag metadata-source-tmdb">TMDB</a>`
            : '';
        const imdbLink = movie.imdb_id
            ? `<a href="https://www.imdb.com/title/${movie.imdb_id}" target="_blank" class="metadata-source-tag metadata-source-tmdb" style="background: #f5c518; color: #000;">IMDB</a>`
            : '';

        appContent.innerHTML = `
            ${backdropUrl ? `<div class="movie-backdrop" style="background-image: url('${backdropUrl}'); height: 300px; background-size: cover; background-position: center top; border-radius: 12px; margin-bottom: 20px; position: relative;">
                <div style="position: absolute; bottom: 0; left: 0; right: 0; height: 120px; background: linear-gradient(transparent, var(--bg-primary));"></div>
            </div>` : ''}

            <div class="page-header">
                <h1 class="page-title">${escapeHtml(movie.title)} ${tmdbLink} ${imdbLink}</h1>
                <div>
                    <button class="btn btn-secondary" onclick="refreshMovieMetadata(${movie.id})">Refresh Metadata</button>
                    <button class="btn btn-danger" onclick="deleteMovie(${movie.id})">Delete</button>
                </div>
            </div>

            <div class="card">
                <div style="display: flex; gap: 20px;">
                    ${posterUrl ? `<img src="${posterUrl}" style="width: 200px; border-radius: 8px;" onerror="this.src='${MOVIE_POSTER_PLACEHOLDER}'">` : ''}
                    <div style="flex: 1;">
                        ${movie.tagline ? `<p style="font-style: italic; color: var(--text-muted); margin-bottom: 12px;">"${escapeHtml(movie.tagline)}"</p>` : ''}
                        <p class="text-muted mb-10">${escapeHtml(movie.overview || 'No description available.')}</p>
                        <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 16px; margin-top: 12px;">
                            <strong>Year:</strong> <span>${year}</span>
                            <strong>Runtime:</strong> <span>${runtime}</span>
                            <strong>Rating:</strong> <span>${rating}</span>
                            ${genres ? `<strong>Genres:</strong> <span>${escapeHtml(genres)}</span>` : ''}
                            ${studios ? `<strong>Studio:</strong> <span>${escapeHtml(studios)}</span>` : ''}
                            <strong>Status:</strong> <span>${escapeHtml(movie.status || 'Unknown')}</span>
                        </div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h3 class="card-title" style="margin-bottom: 12px;">File Information</h3>
                <div style="display: grid; grid-template-columns: auto 1fr; gap: 6px 16px;">
                    <strong>File Status:</strong> <span>${fileStatusBadge}</span>
                    ${movie.file_path ? `<strong>Folder Path:</strong> <span><code style="font-size: 0.85rem;">${escapeHtml(movie.file_path.substring(0, movie.file_path.lastIndexOf('/')))}</code></span>` : ''}
                    ${movie.file_path ? `<strong>File Name:</strong> <span><code style="font-size: 0.85rem;">${escapeHtml(movie.file_path.substring(movie.file_path.lastIndexOf('/') + 1))}</code></span>` : ''}
                    ${fileSizeStr ? `<strong>File Size:</strong> <span>${fileSizeStr}</span>` : ''}
                </div>

                <div style="margin-top: 16px;">
                    <h4 style="margin-bottom: 8px;">Settings</h4>
                    <div class="form-group" style="margin-bottom: 8px;">
                        <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                            <input type="checkbox" id="movie-do-rename" ${movie.do_rename ? 'checked' : ''} onchange="updateMovieSettings(${movie.id})">
                            Enable renaming for this movie
                        </label>
                    </div>
                    <div class="form-group" style="margin-bottom: 8px;">
                        <label>Folder Path</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="movie-folder-path" class="form-control" value="${escapeHtml(movie.folder_path || '')}" placeholder="/path/to/movie/folder" style="flex: 1;">
                            <button class="btn btn-sm btn-secondary" onclick="updateMovieSettings(${movie.id})">Save</button>
                        </div>
                    </div>
                    <div class="form-group" style="margin-bottom: 8px;">
                        <label>Edition</label>
                        <div style="display: flex; gap: 8px;">
                            <input type="text" id="movie-edition" class="form-control" value="${escapeHtml(movie.edition || '')}" placeholder="e.g. Director's Cut, Extended" style="flex: 1;">
                            <button class="btn btn-sm btn-secondary" onclick="updateMovieSettings(${movie.id})">Save</button>
                        </div>
                    </div>
                </div>
            </div>

            ${movie.collection_name ? `
                <div class="card">
                    <h3 class="card-title" style="margin-bottom: 8px;">Collection</h3>
                    <p class="text-muted">${escapeHtml(movie.collection_name)}</p>
                </div>
            ` : ''}

            <div class="card">
                <h3 class="card-title" style="margin-bottom: 12px;">Rename Preview</h3>
                <div id="movie-rename-preview-container">
                    <p class="text-muted">Click "Preview" to see what the renamed file would look like.</p>
                </div>
                <div style="display: flex; gap: 10px; margin-top: 12px;">
                    <button class="btn btn-secondary" onclick="previewMovieRename(${movie.id})">Preview Rename</button>
                    <button class="btn btn-primary" id="movie-apply-rename-btn" onclick="applyMovieRename(${movie.id})" disabled>Apply Rename</button>
                </div>
            </div>
        `;

        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load movie details.</div>`;
    }
}

async function updateMovieSettings(movieId) {
    const folderPath = document.getElementById('movie-folder-path')?.value.trim();
    const doRename = document.getElementById('movie-do-rename')?.checked;
    const edition = document.getElementById('movie-edition')?.value.trim();

    try {
        await api(`/movies/${movieId}`, {
            method: 'PUT',
            body: JSON.stringify({
                folder_path: folderPath || null,
                do_rename: doRename,
                edition: edition || null
            })
        });
        showToast('Movie settings updated', 'success');
    } catch (error) {
        // Error already shown
    }
}

// ── Rename Previews ──────────────────────────────────────────────

async function previewMovieRename(movieId) {
    const container = document.getElementById('movie-rename-preview-container');
    if (!container) return;

    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const previews = await api('/scan/movie-rename-previews');

        // Filter to this movie
        const moviePreviews = previews.filter(p => p.movie_id === movieId);

        if (moviePreviews.length === 0) {
            container.innerHTML = '<p class="text-muted">No rename needed - file is already correctly named, or renaming is disabled.</p>';
            document.getElementById('movie-apply-rename-btn').disabled = true;
            return;
        }

        container.innerHTML = moviePreviews.map(p => `
            <div style="background: var(--bg-secondary); border-radius: 8px; padding: 12px; margin-bottom: 8px;">
                <div style="margin-bottom: 6px;">
                    <strong>Current:</strong><br>
                    <code style="font-size: 0.85rem; color: var(--text-muted);">${escapeHtml(p.current_path)}</code>
                </div>
                <div>
                    <strong>Renamed:</strong><br>
                    <code style="font-size: 0.85rem; color: var(--primary-color);">${escapeHtml(p.expected_path)}</code>
                </div>
            </div>
        `).join('');

        document.getElementById('movie-apply-rename-btn').disabled = false;
    } catch (error) {
        container.innerHTML = '<p class="text-muted">Failed to load rename preview.</p>';
    }
}

async function applyMovieRename(movieId) {
    const btn = document.getElementById('movie-apply-rename-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Applying...';
    }

    try {
        const result = await api('/scan/apply-movie-renames', { method: 'POST' });
        showToast(result.message || 'Rename applied', 'success');
        // Reload movie detail to show updated paths
        showMovieDetail(movieId, true);
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Apply Rename';
        }
    }
}

// ── Add Movie Modal ──────────────────────────────────────────────

let movieSearchTimeout;

function showAddMovieModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Add Movie';
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Search for a movie</label>
            <div style="display: flex; gap: 10px;">
                <input type="text" id="movie-search-input" class="form-control" placeholder="Enter movie title..." onkeyup="debounceMovieSearch(event)" style="flex: 1;">
                <input type="number" id="movie-search-year" class="form-control" placeholder="Year" style="width: 100px;" onkeyup="debounceMovieSearch(event)">
            </div>
        </div>
        <div id="movie-search-results" class="search-results"></div>
    `;

    modal.classList.add('active');

    // Focus search input
    setTimeout(() => document.getElementById('movie-search-input')?.focus(), 100);
}

function debounceMovieSearch(event) {
    clearTimeout(movieSearchTimeout);
    const query = document.getElementById('movie-search-input')?.value.trim();

    if (!query || query.length < 2) {
        document.getElementById('movie-search-results').innerHTML = '';
        return;
    }

    movieSearchTimeout = setTimeout(() => searchMovies(query), 300);
}

async function searchMovies(query) {
    const resultsDiv = document.getElementById('movie-search-results');
    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const year = document.getElementById('movie-search-year')?.value.trim();
    let endpoint = `/movies/search/tmdb?q=${encodeURIComponent(query)}`;
    if (year) {
        endpoint += `&year=${encodeURIComponent(year)}`;
    }

    try {
        const data = await api(endpoint);

        if (data.results.length === 0) {
            resultsDiv.innerHTML = '<p class="text-muted text-center">No results found.</p>';
            return;
        }

        resultsDiv.innerHTML = data.results.slice(0, 12).map(movie => {
            const posterUrl = getImageUrlOrPlaceholder(movie.poster_path);
            const releaseYear = movie.release_date ? movie.release_date.substring(0, 4) : 'Unknown year';
            return `
                <div class="search-result-item" onclick="showMoviePreviewModal(${movie.id})">
                    <img src="${posterUrl}"
                         class="search-result-poster"
                         onerror="this.src='${MOVIE_POSTER_PLACEHOLDER}'">
                    <div class="search-result-info">
                        <h4>${escapeHtml(movie.title)}</h4>
                        <p>${releaseYear}</p>
                        <p>${escapeHtml((movie.overview || '').substring(0, 100))}${(movie.overview || '').length > 100 ? '...' : ''}</p>
                    </div>
                </div>
            `;
        }).join('');
    } catch (error) {
        resultsDiv.innerHTML = '<p class="text-muted text-center">Search failed.</p>';
    }
}

// ── Movie Preview Modal ──────────────────────────────────────────

async function showMoviePreviewModal(tmdbId) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Movie Preview';
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    modal.classList.add('active');
    modal.classList.add('modal-wide');

    try {
        const data = await api(`/movies/preview/${tmdbId}`);

        const posterUrl = getImageUrlOrPlaceholder(data.poster_path);
        const releaseYear = data.release_date ? data.release_date.substring(0, 4) : 'Unknown';
        const runtime = data.runtime ? `${data.runtime} min` : 'N/A';
        const genres = Array.isArray(data.genres) ? data.genres.join(', ') :
                       (typeof data.genres === 'string' ? data.genres : '');

        // Action buttons
        let actionButtons;
        if (data.in_library) {
            actionButtons = `
                <button class="btn btn-primary" onclick="closeModal(); showMovieDetail(${data.library_id});">View in Library</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
        } else {
            actionButtons = `
                <button class="btn btn-success" onclick="closeModal(); addMovieFromTmdb(${tmdbId});">Add Movie</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
        }

        modalBody.innerHTML = `
            <div class="preview-show-header">
                <img src="${posterUrl}" class="preview-poster" onerror="this.src='${getImageUrlOrPlaceholder(null)}'">
                <div class="preview-info">
                    <h2 style="margin-bottom:6px;">${escapeHtml(data.title || 'Unknown')}</h2>
                    ${data.tagline ? `<p style="font-style: italic; color: var(--text-muted); margin-bottom: 8px;">"${escapeHtml(data.tagline)}"</p>` : ''}
                    <div class="preview-meta">
                        ${data.release_date ? `<p><strong>Release Date:</strong> ${data.release_date}</p>` : ''}
                        <p><strong>Year:</strong> ${releaseYear}</p>
                        <p><strong>Runtime:</strong> ${runtime}</p>
                        ${data.vote_average ? `<p><strong>Rating:</strong> ${data.vote_average.toFixed(1)} / 10</p>` : ''}
                        ${genres ? `<p><strong>Genres:</strong> ${escapeHtml(genres)}</p>` : ''}
                        ${data.status ? `<p><strong>Status:</strong> ${escapeHtml(data.status)}</p>` : ''}
                    </div>
                    ${data.overview ? `<div class="preview-overview"><p class="text-muted">${escapeHtml(data.overview)}</p></div>` : ''}
                </div>
            </div>
            <div class="modal-buttons">
                ${actionButtons}
            </div>
        `;
    } catch (error) {
        modalBody.innerHTML = `
            <p class="text-muted">Failed to load movie preview.</p>
            <p class="text-muted" style="font-size:0.85rem;">${escapeHtml(String(error))}</p>
            <div class="modal-buttons">
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>
        `;
    }
}

// ── Add Movie ────────────────────────────────────────────────────

async function addMovieFromTmdb(tmdbId) {
    try {
        showToast('Adding movie...', 'info');
        const newMovie = await api('/movies', {
            method: 'POST',
            body: JSON.stringify({ tmdb_id: tmdbId })
        });
        showToast('Movie added successfully', 'success');

        // Navigate to the new movie's detail page
        showMovieDetail(newMovie.id);
    } catch (error) {
        // Error already shown
    }
}
