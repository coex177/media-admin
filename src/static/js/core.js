/**
 * Media Admin - Core (constants, state, utilities, navigation, search, setup, theme, init)
 */

const API_BASE = '/api';
const TMDB_IMAGE_BASE = 'https://image.tmdb.org/t/p/w500';

// Application State
const state = {
    shows: [],
    currentShow: null,
    settings: null,
    folders: [],
    actions: [],
    stats: null,
    setupCompleted: false,
    currentPage: 'dashboard',
    currentView: { type: 'page', page: 'dashboard', scrollY: 0 },
    navHistory: [],
    _pendingScrollRestore: 0,
    showsPage: 1,
    showsPerPage: 0,
    totalShows: 0,
    totalPages: 1,
    movies: [],
    currentMovie: null,
    moviesPage: 1,
    moviesPerPage: 0,
    totalMovies: 0,
    moviesTotalPages: 1,
    activeSettingsTab: 'general',
    uiPrefs: {}
};

// DOM Elements
let appContent;
let toastContainer;

// Theme Management
function applyTheme(themeName) {
    // Remove theme attribute for midnight (default), set it for others
    if (themeName === 'midnight' || !themeName) {
        delete document.documentElement.dataset.theme;
    } else {
        document.documentElement.dataset.theme = themeName;
    }
}

async function updateTheme(themeName) {
    applyTheme(themeName);

    // Update active state in UI
    document.querySelectorAll('.theme-option').forEach(option => {
        option.classList.toggle('active', option.dataset.theme === themeName);
    });

    // Save to API
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ theme: themeName })
        });
        state.settings.theme = themeName;
    } catch (error) {
        // Revert on error
        applyTheme(state.settings?.theme || 'midnight');
    }
}

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
    appContent = document.getElementById('app-content');
    toastContainer = document.getElementById('toast-container');

    // Setup navigation
    document.querySelectorAll('.nav-menu a').forEach(link => {
        link.addEventListener('click', (e) => {
            e.preventDefault();
            const page = link.dataset.page;
            navigateTo(page);
        });
    });

    // Handle browser back/forward
    window.addEventListener('hashchange', () => {
        const page = getPageFromHash();
        if (page !== state.currentPage || state.currentView.type !== 'page') {
            navigateTo(page, false, true); // skipHashUpdate = true
        }
    });

    // Check if setup is completed
    checkSetup();

    // Add watcher status dot to Scan nav item
    const scanLink = document.querySelector('.nav-menu a[data-page="scan"]');
    if (scanLink) {
        const dot = document.createElement('span');
        dot.id = 'watcher-status-dot';
        dot.className = 'nav-watcher-dot status-stopped';
        dot.title = 'Watcher: stopped';
        scanLink.appendChild(dot);
    }

    // Start polling watcher status for sidebar indicator
    startWatcherStatusPoll();
});

// Get page from URL hash
function getPageFromHash() {
    const hash = window.location.hash.slice(1); // Remove the #
    const validPages = ['dashboard', 'shows', 'movies', 'scan', 'settings'];
    return validPages.includes(hash) ? hash : 'dashboard';
}

// Navigation
function navigateTo(page, skipUnsavedCheck = false, skipHashUpdate = false, pushHistory = true) {
    // Push current view to history before switching (unless told not to)
    if (pushHistory) {
        pushCurrentViewToHistory();
    }

    state.currentPage = page;
    state.currentView = { type: 'page', page: page, scrollY: 0 };

    // Update URL hash (unless triggered by hashchange event)
    if (!skipHashUpdate) {
        window.location.hash = page;
    }

    // Update active nav
    document.querySelectorAll('.nav-menu a').forEach(a => {
        a.classList.toggle('active', a.dataset.page === page);
    });

    // Hide episode preview when navigating to a main page
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';
    // Clear global search input
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) searchInput.value = '';

    updateBackButtonVisibility();

    // Render page
    switch (page) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'shows':
            renderShowsList();
            break;
        case 'movies':
            renderMoviesList();
            break;
        case 'scan':
            renderScan();
            break;
        case 'settings':
            renderSettings();
            break;
        default:
            renderDashboard();
    }
}

// Go back to previous view using the history stack
function goBack() {
    if (state.navHistory.length === 0) return;
    const entry = state.navHistory.pop();
    state._pendingScrollRestore = entry.scrollY || 0;

    if (entry.type === 'search') {
        // Restore search input and re-perform search
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) searchInput.value = entry.searchQuery;
        performGlobalSearch(entry.searchQuery, true);
    } else if (entry.type === 'show') {
        showShowDetail(entry.showId, null, null, true);
    } else if (entry.type === 'movie') {
        showMovieDetail(entry.movieId, true);
    } else {
        // page
        navigateTo(entry.page, false, false, false);
    }
    updateBackButtonVisibility();
}

// Restore scroll position after navigating back
function restorePendingScroll() {
    if (state._pendingScrollRestore) {
        const pos = state._pendingScrollRestore;
        state._pendingScrollRestore = 0;
        requestAnimationFrame(() => window.scrollTo(0, pos));
    }
}

// Push the current view onto the history stack
function pushCurrentViewToHistory() {
    state.currentView.scrollY = window.scrollY;
    state.navHistory.push({ ...state.currentView });
    updateBackButtonVisibility();
}

// Show/hide back button based on history stack
function updateBackButtonVisibility() {
    const backSection = document.getElementById('nav-back-section');
    if (backSection) {
        backSection.style.display = state.navHistory.length > 0 ? 'block' : 'none';
    }
}

// Search Source Toggle
function getSearchSource() {
    const checked = document.querySelector('input[name="global-search-source"]:checked');
    return checked ? checked.value : (state.settings?.default_metadata_source || 'tmdb');
}

function setSearchSource(source, labelEl) {
    // Explicitly set the radio state — onclick fires before the browser toggles the radio
    const toggle = document.getElementById('global-search-source-toggle');
    if (toggle) {
        toggle.querySelectorAll('label').forEach(l => {
            l.classList.remove('active');
            const input = l.querySelector('input');
            if (input) input.checked = (input.value === source);
        });
        if (labelEl) labelEl.classList.add('active');
    }
    // If there's an active search, re-run it with the new source
    const searchInput = document.getElementById('global-search-input');
    if (searchInput && searchInput.value.trim().length >= 2) {
        performGlobalSearch(searchInput.value.trim());
    }
}

function initSearchSourceToggle() {
    const defaultSource = state.settings?.default_metadata_source || 'tmdb';
    const toggle = document.getElementById('global-search-source-toggle');
    if (toggle) {
        toggle.querySelectorAll('label').forEach(l => {
            const input = l.querySelector('input');
            if (input && input.value === defaultSource) {
                input.checked = true;
                l.classList.add('active');
            } else {
                if (input) input.checked = false;
                l.classList.remove('active');
            }
        });
    }
}

// Image URL helper - handles both TMDB paths and TVDB full URLs
function getImageUrl(path) {
    if (!path) return '';
    if (path.startsWith('http')) return path;
    return TMDB_IMAGE_BASE + path;
}

function getImageUrlOrPlaceholder(path) {
    const placeholder = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>";
    if (!path) return placeholder;
    if (path.startsWith('http')) return path;
    return TMDB_IMAGE_BASE + path;
}

// Global Search
let globalSearchTimeout;
function debounceGlobalSearch(event) {
    clearTimeout(globalSearchTimeout);
    const query = event.target.value.trim();

    if (query.length < 2) {
        // If search is cleared and we were viewing search results, go back
        if (state.currentView.type === 'search') {
            goBack();
        }
        return;
    }

    globalSearchTimeout = setTimeout(() => performGlobalSearch(query), 300);
}

function handleSearchKeydown(event) {
    if (event.key === 'Escape') {
        event.target.value = '';
        if (state.currentView.type === 'search') {
            goBack();
        }
    }
}

async function performGlobalSearch(query, skipHistoryPush = false) {
    // Only push history when first entering search from another view
    if (!skipHistoryPush && state.currentView.type !== 'search') {
        pushCurrentViewToHistory();
    }

    // Update current view to search
    state.currentView = { type: 'search', page: state.currentPage, searchQuery: query, scrollY: 0 };

    // Clear active nav highlight
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    // Hide episode preview
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';

    updateBackButtonVisibility();

    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const searchSource = getSearchSource();

        // Check if query is a numeric ID (TMDB ID lookup)
        const isNumericId = /^\d{4,}$/.test(query.trim());

        // Extract year from query if present (e.g., "Black 2017" or "Black (2017)")
        const yearMatch = query.match(/\b(19|20)\d{2}\b/);
        const searchYear = yearMatch ? yearMatch[0] : null;
        const yearParam = searchYear ? `&year=${searchYear}` : '';

        let providerResults, movieResults;

        if (isNumericId && searchSource === 'tmdb') {
            // Direct TMDB ID lookup for shows and movies
            const tmdbId = parseInt(query.trim(), 10);
            const [showLookup, movieLookup] = await Promise.all([
                api(`/shows/lookup/tmdb/${tmdbId}`).catch(() => null),
                api(`/movies/lookup/tmdb/${tmdbId}`).catch(() => null),
            ]);
            providerResults = { results: showLookup ? [showLookup] : [] };
            movieResults = { results: movieLookup ? [movieLookup] : [] };
        } else {
            // Normal text search
            const showSearchEndpoint = searchSource === 'tvdb'
                ? `/shows/search/tvdb?q=${encodeURIComponent(query)}`
                : `/shows/search/tmdb?q=${encodeURIComponent(query)}${yearParam}`;

            [providerResults, movieResults] = await Promise.all([
                api(showSearchEndpoint),
                api(`/movies/search/tmdb?q=${encodeURIComponent(query)}${yearParam}`).catch(() => ({ results: [] })),
            ]);
        }

        // Always fetch local library for matching
        const [localShowsResp, localMoviesResp] = await Promise.all([
            api('/shows'),
            api('/movies').catch(() => ({ movies: [] })),
        ]);
        const localShows = localShowsResp.shows;
        const localMovies = localMoviesResp.movies || [];

        // Filter local shows and movies by name
        const queryLower = query.toLowerCase();
        const matchingLocalShows = localShows.filter(show =>
            show.name.toLowerCase().includes(queryLower)
        );
        const matchingLocalMovies = localMovies.filter(movie =>
            movie.title.toLowerCase().includes(queryLower)
        );

        renderSearchResults(query, providerResults.results || [], matchingLocalShows, searchSource, movieResults.results || [], matchingLocalMovies);
        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Search Results</h1>
            </div>
            <div class="alert alert-danger">Search failed. Please try again.</div>
        `;
    }
}

function renderSearchResults(query, providerResults, localShows, searchSource = 'tmdb', movieResults = [], matchingLocalMovies = []) {
    const hasLocalResults = localShows.length > 0;
    const hasProviderResults = providerResults.length > 0;
    const hasLocalMovies = matchingLocalMovies.length > 0;
    const hasMovieResults = movieResults.length > 0;
    const sourceName = searchSource === 'tvdb' ? 'TVDB' : 'TMDB';
    const placeholder = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>";

    appContent.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Search Results for "${escapeHtml(query)}"</h1>
        </div>

        ${hasLocalResults ? `
            <div class="card">
                <h2 class="card-title">In Your Library (${localShows.length})</h2>
                <div class="search-results-grid">
                    ${localShows.map(show => `
                        <div class="search-result-card" onclick="showShowDetail(${show.id})">
                            <img src="${getImageUrlOrPlaceholder(show.poster_path)}"
                                 class="search-result-poster-large"
                                 onerror="this.src='${placeholder}'">
                            <div class="search-result-card-info">
                                <h3>${escapeHtml(show.name)}</h3>
                                <p class="text-muted">${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                                <span class="badge badge-success">In Library</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        ${hasProviderResults ? `
            <div class="card">
                <h2 class="card-title">Add from ${sourceName} (${providerResults.length})</h2>
                <div class="search-results-grid">
                    ${providerResults.slice(0, 12).map(show => {
                        const showId = searchSource === 'tvdb' ? (show.tvdb_id || show.id) : show.id;
                        // Check if already in library
                        const inLibrary = searchSource === 'tvdb'
                            ? localShows.some(ls => ls.tvdb_id === showId)
                            : localShows.some(ls => ls.tmdb_id === showId);
                        const posterUrl = getImageUrlOrPlaceholder(show.poster_path);
                        return `
                            <div class="search-result-card ${inLibrary ? 'in-library' : ''}" onclick="showPreviewModal(${showId}, '${searchSource}')">
                                <img src="${posterUrl}"
                                     class="search-result-poster-large"
                                     onerror="this.src='${placeholder}'">
                                <div class="search-result-card-info">
                                    <h3>${escapeHtml(show.name)}</h3>
                                    <p class="text-muted">${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                                    ${inLibrary
                                        ? '<span class="badge badge-success">In Library</span>'
                                        : '<span class="badge badge-primary">+ Add</span>'}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        ` : ''}

        ${hasLocalMovies ? `
            <div class="card">
                <h2 class="card-title">Movies in Your Library (${matchingLocalMovies.length})</h2>
                <div class="search-results-grid">
                    ${matchingLocalMovies.map(movie => `
                        <div class="search-result-card" onclick="showMovieDetail(${movie.id})">
                            <img src="${getImageUrlOrPlaceholder(movie.poster_path)}"
                                 class="search-result-poster-large"
                                 onerror="this.src='${placeholder}'">
                            <div class="search-result-card-info">
                                <h3>${escapeHtml(movie.title)}</h3>
                                <p class="text-muted">${movie.year || 'Unknown year'}</p>
                                <span class="badge badge-success">In Library</span>
                            </div>
                        </div>
                    `).join('')}
                </div>
            </div>
        ` : ''}

        ${hasMovieResults ? `
            <div class="card">
                <h2 class="card-title">Add Movie from TMDB (${movieResults.length})</h2>
                <div class="search-results-grid">
                    ${movieResults.slice(0, 12).map(movie => {
                        const inLibrary = matchingLocalMovies.some(lm => lm.tmdb_id === movie.id);
                        const posterUrl = getImageUrlOrPlaceholder(movie.poster_path);
                        const year = movie.release_date ? movie.release_date.substring(0, 4) : '';
                        return `
                            <div class="search-result-card ${inLibrary ? 'in-library' : ''}" onclick="showMoviePreviewModal(${movie.id})">
                                <img src="${posterUrl}"
                                     class="search-result-poster-large"
                                     onerror="this.src='${placeholder}'">
                                <div class="search-result-card-info">
                                    <h3>${escapeHtml(movie.title)}</h3>
                                    <p class="text-muted">${year}</p>
                                    ${inLibrary
                                        ? '<span class="badge badge-success">In Library</span>'
                                        : '<span class="badge badge-primary">+ Add</span>'}
                                </div>
                            </div>
                        `;
                    }).join('')}
                </div>
            </div>
        ` : ''}

        ${!hasLocalResults && !hasProviderResults && !hasLocalMovies && !hasMovieResults ? `
            <div class="card">
                <p class="text-muted text-center">No results found for "${escapeHtml(query)}"</p>
            </div>
        ` : ''}
    `;
}


async function showPreviewModal(providerId, source) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Show Preview';
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    modal.classList.add('active');
    modal.classList.add('modal-wide');

    try {
        const data = await api(`/shows/preview/${source}/${providerId}`);

        const posterUrl = getImageUrlOrPlaceholder(data.poster_path);
        const sourceTag = source === 'tvdb'
            ? `<a href="https://thetvdb.com/dereferrer/series/${providerId}" target="_blank" class="metadata-source-tag metadata-source-tvdb">TVDB</a>`
            : `<a href="https://www.themoviedb.org/tv/${providerId}" target="_blank" class="metadata-source-tag metadata-source-tmdb">TMDB</a>`;

        // Group episodes by season
        const seasons = {};
        (data.episodes || []).forEach(ep => {
            if (!seasons[ep.season]) seasons[ep.season] = [];
            seasons[ep.season].push(ep);
        });
        const seasonNums = Object.keys(seasons).map(Number).sort((a, b) => a - b);

        const seasonsHtml = seasonNums.map(sNum => {
            const eps = seasons[sNum];
            eps.sort((a, b) => a.episode - b.episode);
            const seasonLabel = sNum === 0 ? 'Specials' : `Season ${sNum}`;
            return `
                <div class="preview-season-card">
                    <div class="preview-season-header" onclick="togglePreviewSeason(${sNum})">
                        <span class="season-chevron" id="preview-season-chevron-${sNum}">&#9654;</span>
                        <strong>${seasonLabel}</strong>
                        <span class="text-muted" style="margin-left:auto;">${eps.length} episode${eps.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div class="preview-season-episodes" id="preview-season-${sNum}" style="display:none;">
                        ${eps.map(ep => {
                            const detailsId = `preview-ep-${sNum}-${ep.episode}`;
                            const airDate = ep.air_date || 'TBA';
                            return `
                                <div class="preview-episode-row">
                                    <div class="preview-episode-header" onclick="togglePreviewEpisode('${detailsId}')">
                                        <span class="preview-ep-num">${ep.episode}</span>
                                        <span class="preview-ep-title">${escapeHtml(ep.title || 'TBA')}</span>
                                        <span class="preview-ep-air text-muted">${airDate}</span>
                                        <span class="episode-chevron" id="${detailsId}-chevron">&#9654;</span>
                                    </div>
                                    <div class="preview-episode-details" id="${detailsId}" style="display:none;">
                                        <p class="text-muted" style="font-size:0.85rem;padding:8px 12px;">${escapeHtml(ep.overview || 'No overview available.')}</p>
                                    </div>
                                </div>`;
                        }).join('')}
                    </div>
                </div>`;
        }).join('');

        // Action buttons
        let actionButtons;
        if (data.in_library) {
            actionButtons = `
                <button class="btn btn-primary" onclick="closeModal(); showShowDetail(${data.library_id});">View in Library</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
        } else {
            const escapedName = escapeHtml(data.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
            actionButtons = `
                <button class="btn btn-success" onclick="closeModal(); addShowFromGlobalSearch(${providerId}, '${escapedName}', '${source}');">+ Add Show</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>`;
        }

        modalBody.innerHTML = `
            <div class="preview-show-header">
                <img src="${posterUrl}" class="preview-poster" onerror="this.src='${getImageUrlOrPlaceholder(null)}'">
                <div class="preview-info">
                    <h2 style="margin-bottom:6px;">${escapeHtml(data.name)} ${sourceTag}</h2>
                    <div class="preview-meta">
                        ${data.status ? `<p><strong>Status:</strong> ${escapeHtml(data.status)}</p>` : ''}
                        ${data.first_air_date ? `<p><strong>First Aired:</strong> ${data.first_air_date}</p>` : ''}
                        <p><strong>Seasons:</strong> ${data.number_of_seasons || seasonNums.filter(n => n > 0).length}</p>
                        <p><strong>Episodes:</strong> ${data.number_of_episodes || (data.episodes || []).length}</p>
                        ${data.genres ? `<p><strong>Genres:</strong> ${escapeHtml(data.genres)}</p>` : ''}
                        ${data.networks ? `<p><strong>Networks:</strong> ${escapeHtml(data.networks)}</p>` : ''}
                    </div>
                    ${data.overview ? `<div class="preview-overview"><p class="text-muted">${escapeHtml(data.overview)}</p></div>` : ''}
                </div>
            </div>
            <div class="preview-seasons" style="margin-top:15px;">
                ${seasonsHtml || '<p class="text-muted">No episode data available.</p>'}
            </div>
            <div class="modal-buttons">
                ${actionButtons}
            </div>`;
    } catch (error) {
        modalBody.innerHTML = `
            <p class="text-muted">Failed to load show preview.</p>
            <p class="text-muted" style="font-size:0.85rem;">${escapeHtml(String(error))}</p>
            <div class="modal-buttons">
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>`;
    }
}

function togglePreviewSeason(seasonNum) {
    const el = document.getElementById(`preview-season-${seasonNum}`);
    const chevron = document.getElementById(`preview-season-chevron-${seasonNum}`);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (chevron) chevron.innerHTML = isHidden ? '&#9660;' : '&#9654;';
}

function togglePreviewEpisode(detailsId) {
    const el = document.getElementById(detailsId);
    const chevron = document.getElementById(`${detailsId}-chevron`);
    if (!el) return;
    const isHidden = el.style.display === 'none';
    el.style.display = isHidden ? 'block' : 'none';
    if (chevron) chevron.innerHTML = isHidden ? '&#9660;' : '&#9654;';
}

function addShowFromGlobalSearch(showId, showName, source = 'tmdb') {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Add Show';
    modalBody.innerHTML = `
        <p>Do you already have <strong>${escapeHtml(showName)}</strong> in your library folders?</p>
        <p class="text-muted" style="font-size: 0.9rem;">If yes, we'll scan your library to find and match existing episodes.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="confirmAddShow(${showId}, true, '${source}')">Yes, scan for files</button>
            <button class="btn btn-secondary" onclick="confirmAddShow(${showId}, false, '${source}')">No, just add it</button>
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmAddShow(showId, shouldScan, source = 'tmdb') {
    closeModal();

    try {
        showToast('Adding show...', 'info');
        const body = source === 'tvdb'
            ? { tvdb_id: showId, metadata_source: 'tvdb' }
            : { tmdb_id: showId, metadata_source: 'tmdb' };
        const newShow = await api('/shows', {
            method: 'POST',
            body: JSON.stringify(body)
        });
        if (newShow.source_switched) {
            showToast(`Show added using ${newShow.switched_to.toUpperCase()} (had more episodes than ${newShow.original_source.toUpperCase()})`, 'info');
        } else {
            showToast('Show added successfully', 'success');
        }

        if (shouldScan && newShow.id) {
            // Scan library to find and match episodes
            await scanWithProgress(newShow.id);
        } else {
            // Navigate to the new show's detail page
            showShowDetail(newShow.id);
        }
    } catch (error) {
        // Error already shown
    }
}

// API Functions
async function api(endpoint, options = {}) {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
                ...options.headers
            },
            ...options
        });

        if (!response.ok) {
            const error = await response.json();
            throw new Error(error.detail || 'API request failed');
        }

        return await response.json();
    } catch (error) {
        showToast(error.message, 'error');
        throw error;
    }
}

// ── UI Preferences (DB-backed) ──────────────────────────────────
let _uiPrefsPending = {};
let _uiPrefsFlushTimer = null;

function getUiPref(key, defaultValue) {
    const v = state.uiPrefs[key];
    return v !== undefined ? v : defaultValue;
}

function setUiPref(key, value) {
    state.uiPrefs[key] = value;
    _uiPrefsPending[key] = value;
    if (_uiPrefsFlushTimer) clearTimeout(_uiPrefsFlushTimer);
    _uiPrefsFlushTimer = setTimeout(_flushUiPrefs, 500);
}

async function _flushUiPrefs() {
    const batch = _uiPrefsPending;
    _uiPrefsPending = {};
    _uiPrefsFlushTimer = null;
    if (Object.keys(batch).length === 0) return;
    try {
        await fetch(`${API_BASE}/ui-prefs`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ prefs: batch })
        });
    } catch (e) {
        // silently fail — prefs are still in memory
    }
}

async function loadUiPrefs() {
    try {
        const prefs = await fetch(`${API_BASE}/ui-prefs`).then(r => r.json());
        state.uiPrefs = prefs && typeof prefs === 'object' ? prefs : {};
    } catch (e) {
        state.uiPrefs = {};
    }

    // One-time migration: if DB is empty and localStorage has data
    if (Object.keys(state.uiPrefs).length === 0 && localStorage.getItem('showsViewMode')) {
        const migrationKeys = [
            'showsViewMode', 'dashboardCardOrder', 'dashboardCardStates',
            'expandedDistributions', 'settingsActiveTab',
            'showsListExpandDefault', 'showsListExpandOverrides',
            'missingGroupCollapseStates', 'missingSeasonCollapseStates',
            'watcherLogManualState'
        ];
        const migration = {};
        migrationKeys.forEach(key => {
            const raw = localStorage.getItem(key);
            if (raw !== null) {
                try { migration[key] = JSON.parse(raw); } catch { migration[key] = raw; }
            }
        });
        if (Object.keys(migration).length > 0) {
            state.uiPrefs = migration;
            try {
                await fetch(`${API_BASE}/ui-prefs`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ prefs: migration })
                });
            } catch (e) { /* ignore */ }
            migrationKeys.forEach(key => localStorage.removeItem(key));
        }
    }
}

// Check Setup Status
async function checkSetup() {
    try {
        const [settings] = await Promise.all([api('/settings'), loadUiPrefs()]);
        state.settings = settings;
        state.setupCompleted = settings.setup_completed;

        // Apply DB-backed prefs to module-level vars
        state.activeSettingsTab = getUiPref('settingsActiveTab', 'general');
        activeScanTab = getUiPref('scanActiveTab', 'operations');
        currentShowsView = getUiPref('showsViewMode', 'cards');
        currentMoviesView = getUiPref('moviesViewMode', 'cards');
        dashboardCardOrder = getUiPref('dashboardCardOrder', null) || [...defaultCardOrder];
        // Ensure any new cards are added to existing user's order
        defaultCardOrder.forEach(cardId => {
            if (!dashboardCardOrder.includes(cardId)) {
                dashboardCardOrder.push(cardId);
            }
        });
        dashboardCardStates = getUiPref('dashboardCardStates', {});
        statCardOrder = getUiPref('statCardOrder', null) || [...defaultStatCardOrder];
        defaultStatCardOrder.forEach(cardId => {
            if (!statCardOrder.includes(cardId)) statCardOrder.push(cardId);
        });
        hiddenCards = getUiPref('hiddenCards', []);

        // Apply saved theme
        applyTheme(settings.theme || 'midnight');

        // Initialize search source toggle to match default
        initSearchSourceToggle();

        if (!state.setupCompleted) {
            renderSetupWizard();
        } else {
            // Navigate to page from URL hash, or dashboard if no hash
            const page = getPageFromHash();
            navigateTo(page, false, false, false);
        }
    } catch (error) {
        showToast('Failed to load settings', 'error');
    }
}

// Setup Wizard
function renderSetupWizard() {
    appContent.innerHTML = `
        <div class="setup-container">
            <div class="card">
                <h2 class="mb-20">Welcome to Media Admin</h2>
                <p class="text-muted mb-20">Let's get you set up. You'll need a TMDB API key to search for TV shows.</p>

                <div class="setup-step">
                    <h3><span class="setup-step-number">1</span> TMDB API Key</h3>
                    <p class="text-muted mb-10">Get a free API key from <a href="https://www.themoviedb.org/settings/api" target="_blank" style="color: var(--primary-color)">themoviedb.org</a></p>
                    <div class="form-group">
                        <input type="text" id="setup-api-key" class="form-control" placeholder="Enter your TMDB API key">
                    </div>
                </div>

                <div class="setup-step">
                    <h3><span class="setup-step-number">2</span> Add Library Folder</h3>
                    <p class="text-muted mb-10">Where are your TV shows stored?</p>
                    <div class="form-group">
                        <input type="text" id="setup-library-path" class="form-control" placeholder="/path/to/tv/shows">
                    </div>
                </div>

                <div class="setup-step">
                    <h3><span class="setup-step-number">3</span> Add TV Folder (Optional)</h3>
                    <p class="text-muted mb-10">Where do your TV show downloads appear?</p>
                    <div class="form-group">
                        <input type="text" id="setup-tv-path" class="form-control" placeholder="/path/to/downloads">
                    </div>
                </div>

                <button class="btn btn-primary" onclick="completeSetup()">Complete Setup</button>
            </div>
        </div>
    `;
}

async function completeSetup() {
    const apiKey = document.getElementById('setup-api-key').value.trim();
    const libraryPath = document.getElementById('setup-library-path').value.trim();
    const tvPath = document.getElementById('setup-tv-path').value.trim();

    if (!apiKey) {
        showToast('Please enter your TMDB API key', 'warning');
        return;
    }

    try {
        // Save API key
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdb_api_key: apiKey })
        });

        // Add library folder
        if (libraryPath) {
            await api('/folders', {
                method: 'POST',
                body: JSON.stringify({ path: libraryPath, type: 'library' })
            });
        }

        // Add TV folder
        if (tvPath) {
            await api('/folders', {
                method: 'POST',
                body: JSON.stringify({ path: tvPath, type: 'tv' })
            });
        }

        state.setupCompleted = true;
        showToast('Setup completed!', 'success');
        navigateTo('dashboard', false, false, false);
    } catch (error) {
        // Error already shown by api()
    }
}

function closeModal() {
    const modal = document.getElementById('modal');
    modal.classList.remove('active');
    modal.classList.remove('modal-wide');
}

// Toast Notifications
function showToast(message, type = 'info') {
    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.textContent = message;

    toastContainer.appendChild(toast);

    setTimeout(() => {
        toast.remove();
    }, 4000);
}

// Utility Functions
function generateSelectOptions(max, selected, template) {
    let html = '';
    for (let i = 1; i <= max; i++) {
        let label = template.replace('{n}', i);
        // Handle singular: "Days" -> "Day", "Shows" -> "Show", "Episodes" -> "Episode"
        if (i === 1) {
            label = label.replace('Days', 'Day').replace('Shows', 'Show').replace('Episodes', 'Episode').replace('Movies', 'Movie');
        }
        html += `<option value="${i}" ${i === selected ? 'selected' : ''}>${label}</option>`;
    }
    return html;
}

function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

function formatEpisodeCode(season, episode, format) {
    // Format episode code based on user's display preference
    // Supports: {season}, {season:02d}, {episode}, {episode:02d}
    if (!format) format = '{season}x{episode:02d}';

    return format
        .replace('{season:02d}', String(season).padStart(2, '0'))
        .replace('{season}', season)
        .replace('{episode:02d}', String(episode).padStart(2, '0'))
        .replace('{episode}', episode);
}
