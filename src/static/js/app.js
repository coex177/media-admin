/**
 * Media Admin - Web UI Application
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
    previousPage: null,
    viewingShow: false,
    viewingSearch: false,
    cameFromSearch: false,
    lastSearchQuery: '',
    savedScrollPosition: 0,
    pendingScrollRestore: false
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
        if (page !== state.currentPage) {
            navigateTo(page, false, true); // skipHashUpdate = true
        }
    });

    // Check if setup is completed
    checkSetup();
});

// Get page from URL hash
function getPageFromHash() {
    const hash = window.location.hash.slice(1); // Remove the #
    const validPages = ['dashboard', 'shows', 'scan', 'settings'];
    return validPages.includes(hash) ? hash : 'dashboard';
}

// Navigation
function navigateTo(page, skipUnsavedCheck = false, skipHashUpdate = false) {
    // Check for unsaved settings when leaving settings page
    if (!skipUnsavedCheck && state.currentPage === 'settings' && hasUnsavedSettings()) {
        showUnsavedSettingsModal(page);
        return;
    }

    // Clear unsaved flags when navigating away
    if (state.currentPage === 'settings') {
        settingsChanged.formats = false;
        settingsChanged.dashboard = false;
    }

    state.currentPage = page;

    // Update URL hash (unless triggered by hashchange event)
    if (!skipHashUpdate) {
        window.location.hash = page;
    }

    // Update active nav
    document.querySelectorAll('.nav-menu a').forEach(a => {
        a.classList.toggle('active', a.dataset.page === page);
    });

    // Hide back button and episode preview when navigating to a main page
    state.viewingShow = false;
    state.viewingSearch = false;
    state.cameFromSearch = false;
    state.lastSearchQuery = '';
    const backSection = document.getElementById('nav-back-section');
    if (backSection) backSection.style.display = 'none';
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';
    // Clear global search input
    const searchInput = document.getElementById('global-search-input');
    if (searchInput) searchInput.value = '';

    // Render page
    switch (page) {
        case 'dashboard':
            renderDashboard();
            break;
        case 'shows':
            renderShowsList();
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

// Go back to previous page (from show detail or search)
function goBack() {
    // If we came from search and have a search query, return to search results
    if (state.cameFromSearch && state.lastSearchQuery) {
        state.cameFromSearch = false;
        state.viewingShow = false;
        // Restore search input and re-perform search
        const searchInput = document.getElementById('global-search-input');
        if (searchInput) searchInput.value = state.lastSearchQuery;
        performGlobalSearch(state.lastSearchQuery);
        return;
    }

    const page = state.previousPage || 'dashboard';
    state.previousPage = null;
    state.viewingShow = false;
    state.viewingSearch = false;
    state.cameFromSearch = false;
    state.lastSearchQuery = '';
    state.pendingScrollRestore = true;
    navigateTo(page);
}

// Restore scroll position after navigating back
function restorePendingScroll() {
    if (state.pendingScrollRestore) {
        const pos = state.savedScrollPosition;
        state.pendingScrollRestore = false;
        state.savedScrollPosition = 0;
        requestAnimationFrame(() => window.scrollTo(0, pos));
    }
}

// Global Search
let globalSearchTimeout;
function debounceGlobalSearch(event) {
    clearTimeout(globalSearchTimeout);
    const query = event.target.value.trim();

    if (query.length < 2) {
        // If search is cleared and we were viewing search results, go back
        if (state.viewingSearch) {
            goBack();
        }
        return;
    }

    globalSearchTimeout = setTimeout(() => performGlobalSearch(query), 300);
}

function handleSearchKeydown(event) {
    if (event.key === 'Escape') {
        event.target.value = '';
        if (state.viewingSearch) {
            goBack();
        }
    }
}

async function performGlobalSearch(query) {
    // Store the search query for back navigation
    state.lastSearchQuery = query;

    // Track where we came from (only if not already viewing search)
    if (!state.viewingSearch && !state.viewingShow) {
        state.previousPage = state.currentPage;
    }
    state.viewingSearch = true;
    state.viewingShow = false;
    state.cameFromSearch = false;

    // Show back button in sidebar
    const backSection = document.getElementById('nav-back-section');
    if (backSection) backSection.style.display = 'block';

    // Clear active nav highlight
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    // Hide episode preview
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';

    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        // Search both TMDB and local library
        const [tmdbResults, localShows] = await Promise.all([
            api(`/shows/search/tmdb?q=${encodeURIComponent(query)}`),
            api('/shows')
        ]);

        // Filter local shows by name
        const queryLower = query.toLowerCase();
        const matchingLocalShows = localShows.filter(show =>
            show.name.toLowerCase().includes(queryLower)
        );

        renderSearchResults(query, tmdbResults.results || [], matchingLocalShows);
    } catch (error) {
        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Search Results</h1>
            </div>
            <div class="alert alert-danger">Search failed. Please try again.</div>
        `;
    }
}

function renderSearchResults(query, tmdbResults, localShows) {
    const hasLocalResults = localShows.length > 0;
    const hasTmdbResults = tmdbResults.length > 0;

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
                            <img src="${show.poster_path ? TMDB_IMAGE_BASE + show.poster_path : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'}"
                                 class="search-result-poster-large"
                                 onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'">
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

        ${hasTmdbResults ? `
            <div class="card">
                <h2 class="card-title">Add from TMDB (${tmdbResults.length})</h2>
                <div class="search-results-grid">
                    ${tmdbResults.slice(0, 12).map(show => {
                        // Check if already in library
                        const inLibrary = localShows.some(ls => ls.tmdb_id === show.id);
                        const escapedName = escapeHtml(show.name).replace(/'/g, "\\'").replace(/"/g, '&quot;');
                        return `
                            <div class="search-result-card ${inLibrary ? 'in-library' : ''}" onclick="${inLibrary ? `showShowDetailByTmdbId(${show.id})` : `addShowFromGlobalSearch(${show.id}, '${escapedName}')`}">
                                <img src="${show.poster_path ? TMDB_IMAGE_BASE + show.poster_path : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'}"
                                     class="search-result-poster-large"
                                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'">
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

        ${!hasLocalResults && !hasTmdbResults ? `
            <div class="card">
                <p class="text-muted text-center">No results found for "${escapeHtml(query)}"</p>
            </div>
        ` : ''}
    `;
}

async function showShowDetailByTmdbId(tmdbId) {
    // Find the local show by TMDB ID
    try {
        const shows = await api('/shows');
        const localShow = shows.find(s => s.tmdb_id === tmdbId);
        if (localShow) {
            showShowDetail(localShow.id);
        }
    } catch (error) {
        showToast('Failed to find show', 'error');
    }
}

function addShowFromGlobalSearch(tmdbId, showName) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Add Show';
    modalBody.innerHTML = `
        <p>Do you already have <strong>${escapeHtml(showName)}</strong> in your library folders?</p>
        <p class="text-muted" style="font-size: 0.9rem;">If yes, we'll scan your library to find and match existing episodes.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="confirmAddShow(${tmdbId}, true)">Yes, scan for files</button>
            <button class="btn btn-secondary" onclick="confirmAddShow(${tmdbId}, false)">No, just add it</button>
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmAddShow(tmdbId, shouldScan) {
    closeModal();

    try {
        showToast('Adding show...', 'info');
        const newShow = await api('/shows', {
            method: 'POST',
            body: JSON.stringify({ tmdb_id: tmdbId })
        });
        showToast('Show added successfully', 'success');

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

function showUnsavedSettingsModal(targetPage) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Unsaved Changes';
    modalBody.innerHTML = `
        <p>You have unsaved changes in Settings. What would you like to do?</p>
        <div class="modal-buttons">
            <button class="btn btn-primary" onclick="saveAllSettingsAndNavigate('${targetPage}')">Save Changes</button>
            <button class="btn btn-danger" onclick="discardSettingsAndNavigate('${targetPage}')">Discard Changes</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;

    modal.classList.add('active');
}

async function saveAllSettingsAndNavigate(targetPage) {
    // Save any changed sections
    if (settingsChanged.formats) {
        await updateFormats();
    }
    if (settingsChanged.dashboard) {
        await updateDashboardSettings();
    }
    closeModal();
    navigateTo(targetPage, true);
}

function discardSettingsAndNavigate(targetPage) {
    closeModal();
    navigateTo(targetPage, true);
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

// Check Setup Status
async function checkSetup() {
    try {
        const settings = await api('/settings');
        state.settings = settings;
        state.setupCompleted = settings.setup_completed;

        // Apply saved theme
        applyTheme(settings.theme || 'midnight');

        if (!state.setupCompleted) {
            renderSetupWizard();
        } else {
            // Navigate to page from URL hash, or dashboard if no hash
            const page = getPageFromHash();
            navigateTo(page);
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
                    <h3><span class="setup-step-number">3</span> Add Download Folder (Optional)</h3>
                    <p class="text-muted mb-10">Where do new downloads appear?</p>
                    <div class="form-group">
                        <input type="text" id="setup-download-path" class="form-control" placeholder="/path/to/downloads">
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
    const downloadPath = document.getElementById('setup-download-path').value.trim();

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

        // Add download folder
        if (downloadPath) {
            await api('/folders', {
                method: 'POST',
                body: JSON.stringify({ path: downloadPath, type: 'download' })
            });
        }

        state.setupCompleted = true;
        showToast('Setup completed!', 'success');
        navigateTo('dashboard');
    } catch (error) {
        // Error already shown by api()
    }
}

// Dashboard view state
let currentShowsView = localStorage.getItem('showsViewMode') || 'cards';

// Dashboard card states - load from localStorage
const defaultCardOrder = [
    'recently-aired', 'upcoming', 'recently-added', 'recently-ended',
    'most-incomplete', 'recently-matched', 'returning-soon',
    'last-scan', 'storage-stats', 'genre-distribution', 'network-distribution'
];
let dashboardCardOrder = JSON.parse(localStorage.getItem('dashboardCardOrder')) || [...defaultCardOrder];
// Ensure any new cards are added to existing user's order
defaultCardOrder.forEach(cardId => {
    if (!dashboardCardOrder.includes(cardId)) {
        dashboardCardOrder.push(cardId);
    }
});
let dashboardCardStates = JSON.parse(localStorage.getItem('dashboardCardStates')) || {};

// Dashboard data cache for re-rendering after drag
let dashboardData = {};

// Dashboard
async function renderDashboard() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [
            stats, recentlyAired, recentlyAdded, upcoming, recentlyEnded,
            mostIncomplete, recentlyMatched, returningSoon, lastScan,
            storageStats, genreDistribution, networkDistribution, settings
        ] = await Promise.all([
            api('/stats'),
            api('/recently-aired'),
            api('/recently-added'),
            api('/upcoming'),
            api('/recently-ended'),
            api('/most-incomplete'),
            api('/recently-matched'),
            api('/returning-soon'),
            api('/last-scan'),
            api('/storage-stats'),
            api('/genre-distribution'),
            api('/network-distribution'),
            api('/settings')
        ]);

        state.stats = stats;
        state.settings = settings;
        dashboardData = {
            stats, recentlyAired, recentlyAdded, upcoming, recentlyEnded,
            mostIncomplete, recentlyMatched, returningSoon, lastScan,
            storageStats, genreDistribution, networkDistribution, settings
        };

        renderDashboardContent();
    } catch (error) {
        appContent.innerHTML = `
            <div class="alert alert-danger">
                Failed to load dashboard. Please check your connection and try again.
            </div>
        `;
    }
}

function renderDashboardContent() {
    const {
        stats, recentlyAired, recentlyAdded, upcoming, recentlyEnded,
        mostIncomplete, recentlyMatched, returningSoon, lastScan,
        storageStats, genreDistribution, networkDistribution, settings
    } = dashboardData;
    const upcomingDays = settings?.upcoming_days || 14;
    const recentlyAiredDays = settings?.recently_aired_days || 14;
    const displayEpFormat = settings?.display_episode_format || '{season}x{episode:02d}';
    const allExpanded = dashboardCardOrder.every(id => dashboardCardStates[id]);

    // Calculate collection progress (ignored + specials count as collected)
    const collectedEpisodes = stats.found_episodes + (stats.ignored_episodes || 0) + (stats.special_episodes || 0);
    const totalAired = collectedEpisodes + stats.missing_episodes;
    const collectionPercent = totalAired > 0 ? ((collectedEpisodes / totalAired) * 100).toFixed(1) : 0;

    // Card render functions
    const cardRenderers = {
        'recently-aired': () => {
            const isOpen = dashboardCardStates['recently-aired'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="recently-aired"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-aired')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-recently-aired">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Recently Aired (${recentlyAiredDays} days)
                        </h2>
                        <span class="badge ${recentlyAired.filter(e => e.file_status === 'missing').length > 0 ? 'badge-danger' : 'badge-success'}">
                            ${recentlyAired.filter(e => e.file_status !== 'missing').length}/${recentlyAired.length} collected
                        </span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-aired">
                        ${recentlyAired.length === 0 ? `
                            <p class="text-muted text-center">No recently aired episodes</p>
                        ` : `
                            <div class="recent-episodes-list">
                                ${recentlyAired.map(ep => `
                                    <div class="recent-episode-item ${ep.file_status}" onclick="showShowDetail(${ep.show_id}, ${ep.season}, ${ep.episode})">
                                        <div class="recent-episode-row1">
                                            <span class="recent-episode-show">${escapeHtml(ep.show_name)}</span>
                                            <span class="recent-episode-code">${formatEpisodeCode(ep.season, ep.episode, displayEpFormat)}</span>
                                            <span class="recent-episode-date">${ep.air_date}</span>
                                        </div>
                                        <div class="recent-episode-row2">
                                            <span class="recent-episode-title">${escapeHtml(ep.title)}</span>
                                            <span class="badge badge-sm ${ep.file_status === 'found' ? 'badge-success' : 'badge-danger'}">
                                                ${ep.file_status === 'found' ? 'Added' : 'Missing'}
                                            </span>
                                        </div>
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'recently-added': () => {
            const isOpen = dashboardCardStates['recently-added'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="recently-added"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-added')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-recently-added">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Recently Added Shows
                        </h2>
                        <span class="text-muted">${recentlyAdded.length} shows</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-added">
                        ${recentlyAdded.length === 0 ? `
                            <div class="empty-state-sm">
                                <p class="text-muted">No shows added yet</p>
                                <button class="btn btn-sm btn-primary" onclick="showAddShowModal()">+ Add Show</button>
                            </div>
                        ` : `
                            <div class="recent-shows-list">
                                ${recentlyAdded.map(show => {
                                    const totalAired = show.episodes_found + show.episodes_missing;
                                    const posterUrl = show.poster_path
                                        ? `${TMDB_IMAGE_BASE}${show.poster_path}`
                                        : null;
                                    return `
                                        <div class="recent-show-item" onclick="showShowDetail(${show.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl
                                                    ? `<img src="${posterUrl}" alt="${escapeHtml(show.name)}">`
                                                    : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(show.name)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${show.number_of_seasons} season${show.number_of_seasons !== 1 ? 's' : ''}</span>
                                                    <span class="text-muted">|</span>
                                                    <span>${show.episodes_found}/${totalAired} episodes</span>
                                                </div>
                                                <div class="recent-show-status">
                                                    ${show.episodes_missing > 0
                                                        ? `<span class="badge badge-danger badge-sm">${show.episodes_missing} missing</span>`
                                                        : `<span class="badge badge-success badge-sm">Complete</span>`}
                                                    ${show.episodes_not_aired > 0
                                                        ? `<span class="badge badge-sm" style="background: rgba(149,165,166,0.2); color: var(--text-secondary);">${show.episodes_not_aired} upcoming</span>`
                                                        : ''}
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'upcoming': () => {
            const isOpen = dashboardCardStates['upcoming'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="upcoming"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('upcoming')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-upcoming">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Upcoming (${upcomingDays} days)
                        </h2>
                        <span class="text-muted">${upcoming.length} episodes</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-upcoming">
                        ${upcoming.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No upcoming episodes scheduled</p>
                        ` : `
                            <div class="recent-episodes-list">
                                ${upcoming.map(ep => {
                                    const daysUntil = Math.ceil((new Date(ep.air_date) - new Date()) / (1000 * 60 * 60 * 24));
                                    const dateObj = new Date(ep.air_date + 'T00:00:00');
                                    const formattedDate = dateObj.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                                    const daysLabel = daysUntil === 0 ? `today (${formattedDate})` : daysUntil === 1 ? `tomorrow (${formattedDate})` : `in ${daysUntil} days (${formattedDate})`;
                                    return `
                                        <div class="recent-episode-item upcoming" onclick="showShowDetail(${ep.show_id}, ${ep.season}, ${ep.episode})">
                                            <div class="recent-episode-row1">
                                                <span class="recent-episode-show">${escapeHtml(ep.show_name)}</span>
                                                <span class="recent-episode-code">${formatEpisodeCode(ep.season, ep.episode, displayEpFormat)}</span>
                                                <span class="recent-episode-date upcoming-date">${daysLabel}</span>
                                            </div>
                                            <div class="recent-episode-row2">
                                                <span class="recent-episode-title">${escapeHtml(ep.title)}</span>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'recently-ended': () => {
            const isOpen = dashboardCardStates['recently-ended'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="recently-ended"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-ended')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-recently-ended">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Recently Ended
                        </h2>
                        <span class="text-muted">${recentlyEnded.length} shows</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-ended">
                        ${recentlyEnded.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No recently ended shows</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${recentlyEnded.map(show => {
                                    const posterUrl = show.poster_path
                                        ? `${TMDB_IMAGE_BASE}${show.poster_path}`
                                        : null;
                                    return `
                                        <div class="recent-show-item" onclick="showShowDetail(${show.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl
                                                    ? `<img src="${posterUrl}" alt="${escapeHtml(show.name)}">`
                                                    : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(show.name)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${show.number_of_seasons} season${show.number_of_seasons !== 1 ? 's' : ''}</span>
                                                    <span class="text-muted">|</span>
                                                    <span>${show.episodes_found}/${show.episodes_total} episodes</span>
                                                </div>
                                                <div class="recent-show-status">
                                                    <span class="badge badge-sm" style="background: rgba(149,165,166,0.2); color: var(--text-secondary);">${show.status}</span>
                                                    ${show.episodes_found < show.episodes_total
                                                        ? `<span class="badge badge-danger badge-sm">${show.episodes_total - show.episodes_found} missing</span>`
                                                        : `<span class="badge badge-success badge-sm">Complete</span>`}
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'most-incomplete': () => {
            const isOpen = dashboardCardStates['most-incomplete'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="most-incomplete"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('most-incomplete')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-most-incomplete">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Most Incomplete
                        </h2>
                        <span class="text-muted">${mostIncomplete.length} shows</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-most-incomplete">
                        ${mostIncomplete.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">All shows are complete!</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${mostIncomplete.map(show => {
                                    const posterUrl = show.poster_path ? `${TMDB_IMAGE_BASE}${show.poster_path}` : null;
                                    return `
                                        <div class="recent-show-item" onclick="showShowDetail(${show.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHtml(show.name)}">` : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(show.name)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${show.episodes_found}/${show.total_aired} episodes</span>
                                                    <span class="text-muted">|</span>
                                                    <span>${show.completion_percent}% complete</span>
                                                </div>
                                                <div class="recent-show-status">
                                                    <span class="badge badge-danger badge-sm">${show.episodes_missing} missing</span>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'recently-matched': () => {
            const isOpen = dashboardCardStates['recently-matched'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="recently-matched"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-matched')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-recently-matched">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Recently Matched
                        </h2>
                        <span class="text-muted">${recentlyMatched.length} episodes</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-matched">
                        ${recentlyMatched.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No recently matched episodes</p>
                        ` : `
                            <div class="recent-episodes-list">
                                ${recentlyMatched.map(ep => {
                                    const matchedDate = ep.matched_at ? new Date(ep.matched_at).toLocaleDateString() : 'Unknown';
                                    return `
                                        <div class="recent-episode-item found" onclick="showShowDetail(${ep.show_id}, ${ep.season}, ${ep.episode})">
                                            <div class="recent-episode-row1">
                                                <span class="recent-episode-show">${escapeHtml(ep.show_name)}</span>
                                                <span class="recent-episode-code">${formatEpisodeCode(ep.season, ep.episode, displayEpFormat)}</span>
                                                <span class="recent-episode-date">${matchedDate}</span>
                                            </div>
                                            <div class="recent-episode-row2">
                                                <span class="recent-episode-title">${escapeHtml(ep.title)}</span>
                                                <span class="badge badge-sm badge-success">Matched</span>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'returning-soon': () => {
            const isOpen = dashboardCardStates['returning-soon'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="returning-soon"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('returning-soon')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-returning-soon">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Returning Soon
                        </h2>
                        <span class="text-muted">${returningSoon.length} shows</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-returning-soon">
                        ${returningSoon.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No shows returning soon</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${returningSoon.map(show => {
                                    const posterUrl = show.poster_path ? `${TMDB_IMAGE_BASE}${show.poster_path}` : null;
                                    const daysLabel = show.days_until === 0 ? 'Today' :
                                                      show.days_until === 1 ? 'Tomorrow' :
                                                      show.days_until <= 7 ? `In ${show.days_until} days` :
                                                      show.next_episode_air_date;
                                    return `
                                        <div class="recent-show-item" onclick="showShowDetail(${show.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHtml(show.name)}">` : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(show.name)}</div>
                                                <div class="recent-show-meta">
                                                    <span class="text-primary">${daysLabel}</span>
                                                </div>
                                            </div>
                                        </div>
                                    `;
                                }).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'last-scan': () => {
            const isOpen = dashboardCardStates['last-scan'];
            const scanTime = lastScan.last_scan_time ? new Date(lastScan.last_scan_time).toLocaleString() : 'Never';
            const result = lastScan.result || {};
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="last-scan"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('last-scan')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-last-scan">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Last Scan
                        </h2>
                        <span class="text-muted">${scanTime}</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-last-scan">
                        ${!lastScan.last_scan_time ? `
                            <p class="text-muted text-center" style="padding: 20px;">No scans performed yet</p>
                        ` : `
                            <div style="padding: 15px;">
                                <div class="scan-result-grid">
                                    <div class="scan-result-item">
                                        <span class="scan-result-value">${result.type || 'Unknown'}</span>
                                        <span class="scan-result-label">Scan Type</span>
                                    </div>
                                    <div class="scan-result-item">
                                        <span class="scan-result-value">${result.episodes_matched || 0}</span>
                                        <span class="scan-result-label">Episodes Matched</span>
                                    </div>
                                    <div class="scan-result-item">
                                        <span class="scan-result-value">${(result.unmatched_files || []).length}</span>
                                        <span class="scan-result-label">Unmatched Files</span>
                                    </div>
                                    <div class="scan-result-item">
                                        <span class="scan-result-value">${(result.errors || []).length}</span>
                                        <span class="scan-result-label">Errors</span>
                                    </div>
                                </div>
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'storage-stats': () => {
            const isOpen = dashboardCardStates['storage-stats'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="storage-stats"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('storage-stats')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-storage-stats">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Storage Stats
                        </h2>
                        <span class="text-muted">${storageStats.total_size_gb} GB</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-storage-stats">
                        <div style="padding: 15px;">
                            <div class="scan-result-grid">
                                <div class="scan-result-item">
                                    <span class="scan-result-value">${storageStats.total_size_gb} GB</span>
                                    <span class="scan-result-label">Total Size</span>
                                </div>
                                <div class="scan-result-item">
                                    <span class="scan-result-value">${storageStats.file_count}</span>
                                    <span class="scan-result-label">Files</span>
                                </div>
                                <div class="scan-result-item">
                                    <span class="scan-result-value">${storageStats.average_size_mb} MB</span>
                                    <span class="scan-result-label">Avg Size</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            `;
        },
        'genre-distribution': () => {
            const isOpen = dashboardCardStates['genre-distribution'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="genre-distribution"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('genre-distribution')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-genre-distribution">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Genres
                        </h2>
                        <span class="text-muted">${genreDistribution.length} genres</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-genre-distribution">
                        ${genreDistribution.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No genre data available. Refresh shows to fetch genres.</p>
                        ` : `
                            <div class="distribution-list">
                                ${genreDistribution.slice(0, 10).map(g => `
                                    <div class="distribution-item clickable" onclick="toggleDistributionShows('genre', '${escapeHtml(g.genre).replace(/'/g, "\\'")}')">
                                        <span class="distribution-name">${escapeHtml(g.genre)}</span>
                                        <span class="distribution-count">${g.count} show${g.count !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div class="distribution-shows" id="distribution-genre-${escapeHtml(g.genre)}" style="display: ${isDistributionExpanded('genre', g.genre) ? 'block' : 'none'};">
                                        ${g.shows.map(s => `
                                            <a class="distribution-show-link" onclick="event.stopPropagation(); showShowDetail(${s.id})">${escapeHtml(s.name)}</a>
                                        `).join('')}
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        },
        'network-distribution': () => {
            const isOpen = dashboardCardStates['network-distribution'];
            return `
                <div class="card dashboard-card" draggable="true" data-card-id="network-distribution"
                     ondragstart="handleCardDragStart(event)" ondragover="handleCardDragOver(event)"
                     ondragleave="handleCardDragLeave(event)" ondrop="handleCardDrop(event)" ondragend="handleCardDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('network-distribution')">
                        <h2 class="card-title">
                            <span class="dashboard-card-chevron" id="chevron-network-distribution">${isOpen ? '&#9660;' : '&#9658;'}</span>
                            Networks
                        </h2>
                        <span class="text-muted">${networkDistribution.length} networks</span>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-network-distribution">
                        ${networkDistribution.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No network data available. Refresh shows to fetch networks.</p>
                        ` : `
                            <div class="distribution-list">
                                ${networkDistribution.slice(0, 10).map(n => `
                                    <div class="distribution-item clickable" onclick="toggleDistributionShows('network', '${escapeHtml(n.network).replace(/'/g, "\\'")}')">
                                        <span class="distribution-name">${escapeHtml(n.network)}</span>
                                        <span class="distribution-count">${n.count} show${n.count !== 1 ? 's' : ''}</span>
                                    </div>
                                    <div class="distribution-shows" id="distribution-network-${escapeHtml(n.network)}" style="display: ${isDistributionExpanded('network', n.network) ? 'block' : 'none'};">
                                        ${n.shows.map(s => `
                                            <a class="distribution-show-link" onclick="event.stopPropagation(); showShowDetail(${s.id})">${escapeHtml(s.name)}</a>
                                        `).join('')}
                                    </div>
                                `).join('')}
                            </div>
                        `}
                    </div>
                </div>
            `;
        }
    };

    appContent.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Dashboard</h1>
            <button class="btn btn-sm btn-secondary" onclick="toggleAllDashboardCards()" id="expand-collapse-btn">
                ${allExpanded ? '&#9650; Collapse All' : '&#9660; Expand All'}
            </button>
        </div>

        <div class="stats-grid">
            <div class="stat-card" onclick="navigateTo('shows')">
                <div class="stat-value">${stats.total_shows}</div>
                <div class="stat-label">Total Shows</div>
            </div>
            <div class="stat-card success">
                <div class="stat-value">${stats.found_episodes}</div>
                <div class="stat-label">Episodes Found</div>
            </div>
            <div class="stat-card danger">
                <div class="stat-value">${stats.missing_episodes}</div>
                <div class="stat-label">Episodes Missing</div>
            </div>
            <div class="stat-card special">
                <div class="stat-value">${stats.special_episodes || 0}</div>
                <div class="stat-label">Specials</div>
            </div>
            <div class="stat-card ignored">
                <div class="stat-value">${stats.ignored_episodes || 0}</div>
                <div class="stat-label">Ignored</div>
            </div>
            <div class="stat-card warning" onclick="navigateTo('scan')">
                <div class="stat-value">${stats.pending_actions}</div>
                <div class="stat-label">Pending Actions</div>
            </div>
            <div class="stat-card ${collectionPercent >= 90 ? 'success' : collectionPercent >= 70 ? 'warning' : 'danger'}">
                <div class="stat-value">${collectionPercent}%</div>
                <div class="stat-label">Collection Progress</div>
            </div>
        </div>

        ${stats.pending_actions > 0 ? `
            <div class="alert alert-info">
                You have ${stats.pending_actions} pending actions.
                <a href="#" onclick="navigateTo('scan'); return false;" style="color: inherit; font-weight: bold;">Review them</a>
            </div>
        ` : ''}

        <div class="dashboard-grid" id="dashboard-cards-container">
            ${dashboardCardOrder.map(cardId => cardRenderers[cardId] ? cardRenderers[cardId]() : '').join('')}
        </div>

        <!-- Quick Actions -->
        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Quick Actions</h2>
            </div>
            <div class="quick-actions">
                <button class="quick-action-btn" onclick="showAddShowModal()">
                    <span class="quick-action-icon">+</span>
                    <span>Add Show</span>
                </button>
                <button class="quick-action-btn" onclick="navigateTo('shows')">
                    <span class="quick-action-icon">📺</span>
                    <span>Browse Shows</span>
                </button>
                <button class="quick-action-btn" onclick="navigateTo('scan')">
                    <span class="quick-action-icon">🔍</span>
                    <span>Scan</span>
                </button>
                <button class="quick-action-btn" onclick="navigateTo('settings')">
                    <span class="quick-action-icon">⚙</span>
                    <span>Settings</span>
                </button>
            </div>
        </div>
    `;

    restorePendingScroll();
}

function toggleDistributionShows(type, name) {
    const el = document.getElementById(`distribution-${type}-${name}`);
    if (!el) return;
    const isVisible = el.style.display !== 'none';
    el.style.display = isVisible ? 'none' : 'block';

    // Persist expanded state in localStorage
    const stored = JSON.parse(localStorage.getItem('expandedDistributions') || '{}');
    if (!stored[type]) stored[type] = [];
    if (isVisible) {
        stored[type] = stored[type].filter(n => n !== name);
    } else {
        if (!stored[type].includes(name)) stored[type].push(name);
    }
    localStorage.setItem('expandedDistributions', JSON.stringify(stored));
}

function isDistributionExpanded(type, name) {
    const stored = JSON.parse(localStorage.getItem('expandedDistributions') || '{}');
    return (stored[type] || []).includes(name);
}

function toggleDashboardCard(cardId) {
    const content = document.getElementById(`content-${cardId}`);
    const chevron = document.getElementById(`chevron-${cardId}`);

    if (!content) return;

    const isOpen = content.classList.toggle('open');
    if (chevron) {
        chevron.innerHTML = isOpen ? '&#9660;' : '&#9658;';
    }

    // Save state to localStorage
    dashboardCardStates[cardId] = isOpen;
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));

    // Update expand/collapse all button state
    updateExpandCollapseButton();
}

function toggleAllDashboardCards() {
    const allExpanded = dashboardCardOrder.every(id => dashboardCardStates[id]);
    const newState = !allExpanded;

    dashboardCardOrder.forEach(cardId => {
        const content = document.getElementById(`content-${cardId}`);
        const chevron = document.getElementById(`chevron-${cardId}`);

        dashboardCardStates[cardId] = newState;

        if (content) {
            if (newState) {
                content.classList.add('open');
            } else {
                content.classList.remove('open');
            }
        }
        if (chevron) {
            chevron.innerHTML = newState ? '&#9660;' : '&#9658;';
        }
    });

    // Save state to localStorage
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));

    updateExpandCollapseButton();
}

function updateExpandCollapseButton() {
    const allExpanded = dashboardCardOrder.every(id => dashboardCardStates[id]);

    const btn = document.getElementById('expand-collapse-btn');
    if (btn) {
        btn.innerHTML = allExpanded ? '&#9650; Collapse All' : '&#9660; Expand All';
    }
}

// Drag and drop handlers for dashboard cards
let draggedCardId = null;

function handleCardDragStart(event) {
    draggedCardId = event.target.closest('.dashboard-card').dataset.cardId;
    event.target.closest('.dashboard-card').classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
}

function handleCardDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const card = event.target.closest('.dashboard-card');
    if (card && card.dataset.cardId !== draggedCardId) {
        // Remove drag-over from other cards first
        document.querySelectorAll('.dashboard-card.drag-over').forEach(c => {
            if (c !== card) c.classList.remove('drag-over');
        });
        card.classList.add('drag-over');
    }
}

function handleCardDragLeave(event) {
    const card = event.target.closest('.dashboard-card');
    if (card) {
        card.classList.remove('drag-over');
    }
}

function handleCardDrop(event) {
    event.preventDefault();

    const targetCard = event.target.closest('.dashboard-card');
    if (!targetCard || !draggedCardId) return;

    const targetCardId = targetCard.dataset.cardId;
    if (targetCardId === draggedCardId) return;

    // Reorder the cards
    const draggedIndex = dashboardCardOrder.indexOf(draggedCardId);
    const targetIndex = dashboardCardOrder.indexOf(targetCardId);

    if (draggedIndex !== -1 && targetIndex !== -1) {
        // Remove dragged card from its position
        dashboardCardOrder.splice(draggedIndex, 1);
        // Insert at target position
        dashboardCardOrder.splice(targetIndex, 0, draggedCardId);

        // Save to localStorage
        localStorage.setItem('dashboardCardOrder', JSON.stringify(dashboardCardOrder));

        // Re-render the dashboard cards
        renderDashboardContent();
    }

    // Clean up
    targetCard.classList.remove('drag-over');
}

function handleCardDragEnd(event) {
    draggedCardId = null;
    // Remove all drag styling
    document.querySelectorAll('.dashboard-card').forEach(card => {
        card.classList.remove('dragging', 'drag-over');
    });
}

function setShowsView(view) {
    currentShowsView = view;
    localStorage.setItem('showsViewMode', view);

    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.view-btn[onclick="setShowsView('${view}')"]`)?.classList.add('active');

    // Re-render shows container
    const container = document.getElementById('shows-container');
    if (container && state.shows) {
        container.innerHTML = renderShowsView(state.shows);
    }
}

function renderShowsView(shows) {
    if (shows.length === 0) {
        return `
            <div class="empty-state">
                <div class="empty-state-icon">📺</div>
                <h3>No Shows Yet</h3>
                <p>Add your first TV show to get started.</p>
                <button class="btn btn-primary mt-20" onclick="showAddShowModal()">Add Show</button>
            </div>
        `;
    }

    switch (currentShowsView) {
        case 'compact':
            return `<div class="shows-grid tiles">${shows.map(show => renderShowCardCompact(show)).join('')}</div>`;
        case 'list':
            return `<div class="shows-list">${shows.map(show => renderShowListItem(show)).join('')}</div>`;
        case 'cards':
        default:
            return `<div class="shows-grid">${shows.map(show => renderShowCard(show)).join('')}</div>`;
    }
}

function renderShowCardCompact(show) {
    const posterUrl = show.poster_path
        ? `${TMDB_IMAGE_BASE}${show.poster_path}`
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%23252542" width="100" height="150"/></svg>';

    const totalEpisodes = show.episodes_found + show.episodes_missing + (show.episodes_not_aired || 0);
    const year = show.first_air_date ? show.first_air_date.substring(0, 4) : 'N/A';
    const statusText = show.status === 'Returning Series' ? 'Continuing' :
                       show.status === 'In Production' ? 'In Production' :
                       show.status === 'Ended' ? 'Ended' :
                       show.status === 'Canceled' ? 'Canceled' : show.status;
    const statusClass = (show.status === 'Returning Series' || show.status === 'In Production') ? 'continuing' : 'ended';

    return `
        <div class="show-tile" onclick="showShowDetail(${show.id})">
            <img src="${posterUrl}" alt="${show.name}" class="show-tile-poster" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23252542%22 width=%22100%22 height=%22150%22/></svg>'">
            <div class="show-tile-overlay ${statusClass}">
                <div class="show-tile-name">${escapeHtml(show.name)}</div>
                <div class="show-tile-year">${year}</div>
                <div class="show-tile-details">
                    <span>${show.number_of_seasons} Season${show.number_of_seasons !== 1 ? 's' : ''}</span>
                    <span>${totalEpisodes} Episode${totalEpisodes !== 1 ? 's' : ''}</span>
                </div>
                <div class="show-tile-status ${statusClass}">${statusText}</div>
            </div>
        </div>
    `;
}

function renderShowListItem(show) {
    const totalAired = show.episodes_found + show.episodes_missing;
    const isComplete = show.episodes_missing === 0;

    return `
        <div class="show-list-item" id="show-list-item-${show.id}">
            <div class="show-list-header" onclick="toggleShowListItem(${show.id})">
                <span class="show-list-chevron" id="show-list-chevron-${show.id}">&#9658;</span>
                <span class="show-list-name">${escapeHtml(show.name)}</span>
                <span class="show-list-status">
                    <span class="text-muted">${show.episodes_found}/${totalAired}</span>
                    ${show.episodes_missing > 0
                        ? `<span class="badge badge-danger badge-sm">${show.episodes_missing} missing</span>`
                        : `<span class="badge badge-success badge-sm">Complete</span>`}
                </span>
            </div>
            <div class="show-list-details" id="show-list-details-${show.id}">
                <div class="show-list-details-content">
                    <p class="text-muted mb-10">${escapeHtml((show.overview || 'No description available.').substring(0, 200))}${(show.overview || '').length > 200 ? '...' : ''}</p>
                    <div class="show-list-meta">
                        <span><strong>Status:</strong> ${show.status}</span>
                        <span><strong>Seasons:</strong> ${show.number_of_seasons}</span>
                        ${show.episodes_not_aired > 0 ? `<span><strong>Not Aired:</strong> ${show.episodes_not_aired}</span>` : ''}
                    </div>
                    <button class="btn btn-sm btn-primary mt-10" onclick="event.stopPropagation(); showShowDetail(${show.id})">View Details</button>
                </div>
            </div>
        </div>
    `;
}

function toggleShowListItem(showId) {
    const details = document.getElementById(`show-list-details-${showId}`);
    const chevron = document.getElementById(`show-list-chevron-${showId}`);

    if (!details) return;

    const isOpen = details.classList.contains('open');

    // Toggle current item
    details.classList.toggle('open');
    if (chevron) {
        chevron.innerHTML = isOpen ? '&#9658;' : '&#9660;';
    }
}

function renderShowCard(show) {
    const posterUrl = show.poster_path
        ? `${TMDB_IMAGE_BASE}${show.poster_path}`
        : 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 150"><rect fill="%23252542" width="100" height="150"/><text x="50" y="75" text-anchor="middle" fill="%23666" font-size="12">No Poster</text></svg>';

    const statusClass = (show.status === 'Returning Series' || show.status === 'In Production') ? 'continuing' : 'ended';
    const statusText = show.status === 'Returning Series' ? 'Continuing' :
                       show.status === 'In Production' ? 'In Production' :
                       show.status === 'Ended' ? 'Ended' :
                       show.status === 'Canceled' ? 'Canceled' : show.status;

    const totalEpisodes = show.episodes_found + show.episodes_missing + (show.episodes_not_aired || 0);
    const totalAired = show.episodes_found + show.episodes_missing;
    const year = show.first_air_date ? show.first_air_date.substring(0, 4) : 'N/A';

    return `
        <div class="show-card" onclick="showShowDetail(${show.id})">
            <img src="${posterUrl}" alt="${show.name}" class="show-poster" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 100 150%22><rect fill=%22%23252542%22 width=%22100%22 height=%22150%22/></svg>'">
            <div class="show-tile-overlay ${statusClass}">
                <div class="show-tile-name">${escapeHtml(show.name)}</div>
                <div class="show-tile-year">${year}</div>
                <div class="show-tile-details">
                    <span>${show.number_of_seasons} Season${show.number_of_seasons !== 1 ? 's' : ''}</span>
                    <span>${totalEpisodes} Episode${totalEpisodes !== 1 ? 's' : ''}</span>
                    <span>${show.episodes_found}/${totalAired} Found</span>
                    ${show.episodes_missing > 0 ? `<span style="color: #f87171;">${show.episodes_missing} Missing</span>` : ''}
                </div>
                <div class="show-tile-status ${statusClass}">${statusText}</div>
            </div>
        </div>
    `;
}

// Shows List
async function renderShowsList() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const shows = await api('/shows');
        state.shows = shows;

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Shows</h1>
                <div style="display: flex; gap: 10px; align-items: center;">
                    <div class="view-toggle">
                        <button class="view-btn ${currentShowsView === 'cards' ? 'active' : ''}" onclick="setShowsView('cards')" title="Card View">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="6" height="6" rx="1"/><rect x="9" y="1" width="6" height="6" rx="1"/><rect x="1" y="9" width="6" height="6" rx="1"/><rect x="9" y="9" width="6" height="6" rx="1"/></svg>
                        </button>
                        <button class="view-btn ${currentShowsView === 'compact' ? 'active' : ''}" onclick="setShowsView('compact')" title="Tiles">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="1" width="4" height="4" rx="1"/><rect x="6" y="1" width="4" height="4" rx="1"/><rect x="11" y="1" width="4" height="4" rx="1"/><rect x="1" y="6" width="4" height="4" rx="1"/><rect x="6" y="6" width="4" height="4" rx="1"/><rect x="11" y="6" width="4" height="4" rx="1"/><rect x="1" y="11" width="4" height="4" rx="1"/><rect x="6" y="11" width="4" height="4" rx="1"/><rect x="11" y="11" width="4" height="4" rx="1"/></svg>
                        </button>
                        <button class="view-btn ${currentShowsView === 'list' ? 'active' : ''}" onclick="setShowsView('list')" title="List View">
                            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><rect x="1" y="2" width="14" height="3" rx="1"/><rect x="1" y="7" width="14" height="3" rx="1"/><rect x="1" y="12" width="14" height="3" rx="1"/></svg>
                        </button>
                    </div>
                    <button class="btn btn-secondary" onclick="refreshAllMetadata()" id="refresh-all-btn">Refresh All Metadata</button>
                    <button class="btn btn-secondary" onclick="startSlowImport()">Slow Import</button>
                    <button class="btn btn-primary" onclick="showAddShowModal()">+ Add Show</button>
                </div>
            </div>

            <div id="refresh-progress-container" style="display: none;">
                <div class="card" style="margin-bottom: 20px;">
                    <div class="card-header">
                        <h2 class="card-title">Refreshing Metadata</h2>
                        <span id="refresh-progress-text" class="text-muted">0/0</span>
                    </div>
                    <div style="padding: 15px;">
                        <div class="progress-bar-container">
                            <div class="progress-bar" id="refresh-progress-bar" style="width: 0%"></div>
                        </div>
                        <p id="refresh-current-show" class="text-muted" style="margin-top: 10px; font-size: 0.9rem;"></p>
                    </div>
                </div>
            </div>

            <div class="card">
                <div id="shows-container">
                    ${renderShowsView(shows)}
                </div>
            </div>
        `;

        // Check if refresh is in progress on page load
        checkRefreshStatus();
        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load shows.</div>`;
    }
}

let refreshPollInterval = null;
let refreshWasPolling = false;  // Track if we initiated the polling

async function refreshAllMetadata() {
    const btn = document.getElementById('refresh-all-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Starting...';
    }

    try {
        await api('/shows/refresh-all', { method: 'POST' });
        showToast('Refreshing all metadata...', 'info');
        startRefreshPolling();
    } catch (error) {
        if (btn) {
            btn.disabled = false;
            btn.textContent = 'Refresh All Metadata';
        }
    }
}

function startRefreshPolling() {
    refreshWasPolling = true;  // Mark that we started polling

    const container = document.getElementById('refresh-progress-container');
    if (container) {
        container.style.display = 'block';
    }

    const btn = document.getElementById('refresh-all-btn');
    if (btn) {
        btn.disabled = true;
        btn.textContent = 'Refreshing...';
    }

    // Clear any existing interval
    if (refreshPollInterval) {
        clearInterval(refreshPollInterval);
    }

    refreshPollInterval = setInterval(async () => {
        await checkRefreshStatus();
    }, 1000);
}

async function checkRefreshStatus() {
    try {
        const status = await api('/shows/refresh-all/status');

        const container = document.getElementById('refresh-progress-container');
        const progressBar = document.getElementById('refresh-progress-bar');
        const progressText = document.getElementById('refresh-progress-text');
        const currentShow = document.getElementById('refresh-current-show');
        const btn = document.getElementById('refresh-all-btn');

        if (status.running) {
            // If refresh is running, start polling if we aren't already
            if (!refreshPollInterval) {
                startRefreshPolling();
            }

            if (container) container.style.display = 'block';
            if (btn) {
                btn.disabled = true;
                btn.textContent = 'Refreshing...';
            }

            const percent = status.total > 0 ? (status.current / status.total) * 100 : 0;
            if (progressBar) progressBar.style.width = `${percent}%`;
            if (progressText) progressText.textContent = `${status.current}/${status.total}`;
            if (currentShow) currentShow.textContent = status.current_show ? `Refreshing: ${status.current_show}` : '';
        } else {
            // Refresh complete or not running
            if (refreshPollInterval) {
                clearInterval(refreshPollInterval);
                refreshPollInterval = null;
            }

            if (container) container.style.display = 'none';
            if (btn) {
                btn.disabled = false;
                btn.textContent = 'Refresh All Metadata';
            }

            // Only show completion message if we were actively polling (not on page load)
            if (refreshWasPolling && (status.completed?.length > 0 || status.errors?.length > 0)) {
                refreshWasPolling = false;  // Reset flag to prevent multiple messages

                // Show detailed results modal
                showRefreshResultsModal(status);

                // Reload the shows list without triggering another status check
                const shows = await api('/shows');
                state.shows = shows;
                const showsContainer = document.getElementById('shows-container');
                if (showsContainer) {
                    showsContainer.innerHTML = renderShowsView(shows);
                }
            }
        }
    } catch (error) {
        // Silently fail status checks
    }
}

// Show Detail
async function showShowDetail(showId, targetSeason = null, targetEpisode = null) {
    // Save scroll position before navigating away
    if (!state.viewingShow && !state.viewingSearch) {
        state.savedScrollPosition = window.scrollY;
    }
    // Track where we came from (only if not already viewing a show)
    if (!state.viewingShow && !state.viewingSearch) {
        state.previousPage = state.currentPage;
    }
    // Track if we came from search
    if (state.viewingSearch) {
        state.cameFromSearch = true;
    }
    state.viewingShow = true;
    state.viewingSearch = false;

    // Show back button in sidebar
    const backSection = document.getElementById('nav-back-section');
    if (backSection) backSection.style.display = 'block';

    // Hide episode preview (will show again when an episode is selected)
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';

    // Clear active nav highlight
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const show = await api(`/shows/${showId}`);
        state.currentShow = show;

        // Group episodes by season
        const seasons = {};
        let targetEpisodeId = null;
        show.episodes.forEach(ep => {
            if (!seasons[ep.season]) {
                seasons[ep.season] = [];
            }
            seasons[ep.season].push(ep);
            // Find target episode ID if specified
            if (targetSeason !== null && targetEpisode !== null &&
                ep.season === targetSeason && ep.episode === targetEpisode) {
                targetEpisodeId = ep.id;
            }
        });

        const posterUrl = show.poster_path
            ? `${TMDB_IMAGE_BASE}${show.poster_path}`
            : '';

        const today = new Date().toISOString().split('T')[0];

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">${escapeHtml(show.name)}</h1>
                <div>
                    <button class="btn btn-secondary" onclick="showEditShowModal(${show.id})">Edit Settings</button>
                    <button class="btn btn-secondary" onclick="refreshShow(${show.id})">Refresh Metadata</button>
                    <button class="btn btn-danger" onclick="deleteShow(${show.id})">Delete</button>
                </div>
            </div>

            <div class="card">
                <div style="display: flex; gap: 20px;">
                    ${posterUrl ? `<img src="${posterUrl}" style="width: 150px; border-radius: 8px;">` : ''}
                    <div>
                        <p class="text-muted mb-10">${escapeHtml(show.overview || 'No description available.')}</p>
                        <p><strong>Status:</strong> ${show.status}</p>
                        <p><strong>First Aired:</strong> ${show.first_air_date || 'Unknown'}</p>
                        <p><strong>Seasons:</strong> ${show.number_of_seasons}</p>
                        <p><strong>Episodes:</strong> ${show.episodes_found} found${show.episodes_missing > 0 ? `, ${show.episodes_missing} missing` : ''}${(show.episodes_special || 0) > 0 ? `, ${show.episodes_special} specials` : ''}${(show.episodes_ignored || 0) > 0 ? `, ${show.episodes_ignored} ignored` : ''}${show.episodes_not_aired > 0 ? `, ${show.episodes_not_aired} not aired` : ''}</p>
                        ${show.folder_path ? `<p><strong>Folder:</strong> <code style="font-size: 0.85rem;">${escapeHtml(show.folder_path)}</code></p>` : '<p class="text-muted"><em>No folder configured</em></p>'}
                    </div>
                </div>
            </div>

            ${Object.keys(seasons).sort((a, b) => a - b).map(seasonNum => {
                const seasonEps = seasons[seasonNum];
                const foundCount = seasonEps.filter(e => e.file_status === 'found' || e.file_status === 'renamed' || e.is_ignored || e.is_special).length;
                const airedCount = seasonEps.filter(e => e.file_status !== 'not_aired').length;
                return `
                <div class="card season-card">
                    <div class="season-header-toggle" onclick="toggleSeason(${seasonNum})" id="season-header-${seasonNum}">
                        <div style="display: flex; align-items: center; gap: 10px;">
                            <span class="season-chevron" id="season-chevron-${seasonNum}">&#9658;</span>
                            <h3>${seasonNum == 0 ? 'Specials' : 'Season ' + seasonNum}</h3>
                        </div>
                        <span class="text-muted">${foundCount}/${airedCount} ${seasonNum == 0 ? 'specials' : 'aired episodes'}</span>
                    </div>
                    <div class="episodes-list collapsed" id="season-${seasonNum}-episodes">
                        ${seasonEps.map(ep => {
                            let statusClass, statusLabel;
                            if (ep.is_special) {
                                statusClass = 'special';
                                statusLabel = 'Special';
                            } else if (ep.is_ignored) {
                                statusClass = 'ignored';
                                statusLabel = 'Ignored';
                            } else if (ep.file_status === 'not_aired') {
                                statusClass = 'not-aired';
                                statusLabel = 'Not Aired';
                            } else if (ep.file_status === 'missing') {
                                statusClass = 'missing';
                                statusLabel = 'Missing';
                            } else {
                                statusClass = 'found';
                                statusLabel = ep.file_status === 'found' ? 'Found' : ep.file_status;
                            }
                            return `
                                <div class="episode-row" id="episode-row-${ep.id}" data-still-path="${ep.still_path || ''}">
                                    <div class="episode-header ${statusClass}" onclick="toggleEpisode(${ep.id})">
                                        <span class="episode-number">${ep.episode}</span>
                                        <span class="episode-title">${escapeHtml(ep.title)}</span>
                                        <span class="episode-status-badge ${statusClass}">${statusLabel}</span>
                                        <span class="episode-chevron" id="chevron-${ep.id}">&#9662;</span>
                                    </div>
                                    <div class="episode-details" id="episode-details-${ep.id}">
                                        <div class="episode-details-content">
                                            <p class="episode-overview">${escapeHtml(ep.overview || 'No description available.')}</p>
                                            <div class="episode-meta">
                                                <span><strong>Air Date:</strong> ${ep.air_date || 'TBA'}</span>
                                                ${ep.runtime ? `<span><strong>Runtime:</strong> ${ep.runtime} min</span>` : ''}
                                            </div>
                                            ${ep.file_path ? `<div class="episode-file"><strong>File:</strong> <code>${escapeHtml(ep.file_path)}</code></div>` : ''}
                                        </div>
                                    </div>
                                </div>
                            `;
                        }).join('')}
                    </div>
                </div>
            `}).join('')}
        `;

        // If target season/episode specified, expand that season and scroll to/highlight the episode
        if (targetSeason !== null && targetEpisodeId !== null) {
            // Expand the target season
            const seasonList = document.getElementById(`season-${targetSeason}-episodes`);
            const seasonChevron = document.getElementById(`season-chevron-${targetSeason}`);
            if (seasonList) {
                seasonList.classList.remove('collapsed');
            }
            if (seasonChevron) {
                seasonChevron.innerHTML = '&#9660;';
            }

            // Scroll to and highlight the episode after a brief delay for DOM update
            setTimeout(() => {
                const episodeRow = document.getElementById(`episode-row-${targetEpisodeId}`);
                if (episodeRow) {
                    episodeRow.scrollIntoView({ behavior: 'smooth', block: 'center' });
                    episodeRow.classList.add('highlight');
                    // Remove highlight after animation
                    setTimeout(() => episodeRow.classList.remove('highlight'), 2000);
                }
            }, 100);
        }
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load show details.</div>`;
    }
}

async function refreshShow(showId) {
    try {
        await api(`/shows/${showId}/refresh`, { method: 'POST' });
        showToast('Show metadata refreshed', 'success');
        showShowDetail(showId);
    } catch (error) {
        // Error already shown
    }
}

function deleteShow(showId) {
    const showName = state.currentShow?.name || 'this show';
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Remove Show';
    modalBody.innerHTML = `
        <p>Are you sure you want to remove <strong>${escapeHtml(showName)}</strong> from your library?</p>
        <p class="text-muted" style="font-size: 0.9rem;">This will only remove the show from tracking. Your files will not be deleted.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="confirmDeleteShow(${showId})">Remove Show</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmDeleteShow(showId) {
    closeModal();

    try {
        await api(`/shows/${showId}`, { method: 'DELETE' });
        showToast('Show removed', 'success');
        navigateTo('shows');
    } catch (error) {
        // Error already shown
    }
}

// Episode Accordion Toggle
function toggleEpisode(episodeId) {
    const details = document.getElementById(`episode-details-${episodeId}`);
    const chevron = document.getElementById(`chevron-${episodeId}`);
    const row = document.getElementById(`episode-row-${episodeId}`);
    const preview = document.getElementById('episode-preview');
    const previewImg = document.getElementById('episode-preview-img');

    if (!details) return;

    const isOpen = details.classList.contains('open');

    // Close all other episodes
    document.querySelectorAll('.episode-details.open').forEach(el => {
        el.classList.remove('open');
    });
    document.querySelectorAll('.episode-row.expanded').forEach(el => {
        el.classList.remove('expanded');
    });
    document.querySelectorAll('.episode-chevron').forEach(el => {
        el.innerHTML = '&#9662;';
    });

    // Toggle current episode
    if (!isOpen) {
        details.classList.add('open');
        row.classList.add('expanded');
        chevron.innerHTML = '&#9652;';

        // Show episode preview image (or hide if no still available)
        const stillPath = row.dataset.stillPath;
        if (stillPath && preview && previewImg) {
            previewImg.src = `${TMDB_IMAGE_BASE}${stillPath}`;
            preview.style.display = 'block';
        } else if (preview) {
            preview.style.display = 'none';
        }
    } else {
        // Hide preview when closing episode
        if (preview) preview.style.display = 'none';
    }
}

// Season Toggle
function toggleSeason(seasonNum) {
    const episodesList = document.getElementById(`season-${seasonNum}-episodes`);
    const chevron = document.getElementById(`season-chevron-${seasonNum}`);
    if (!episodesList) return;

    const isCollapsed = episodesList.classList.toggle('collapsed');
    if (chevron) {
        chevron.innerHTML = isCollapsed ? '&#9658;' : '&#9660;';
    }

    // If collapsing, close any open episodes and hide preview
    if (isCollapsed) {
        episodesList.querySelectorAll('.episode-details.open').forEach(el => {
            el.classList.remove('open');
        });
        episodesList.querySelectorAll('.episode-row.expanded').forEach(el => {
            el.classList.remove('expanded');
        });
        episodesList.querySelectorAll('.episode-chevron').forEach(el => {
            el.innerHTML = '&#9662;';
        });
        const preview = document.getElementById('episode-preview');
        if (preview) preview.style.display = 'none';
    }
}

// Edit Show Modal
function showEditShowModal(showId) {
    if (!state.currentShow) return;

    const show = state.currentShow;
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Edit Show Settings';
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Library Folder</label>
            <input type="text" id="modal-folder-path" class="form-control" value="${escapeHtml(show.folder_path || '')}" placeholder="/path/to/show">
        </div>
        <div class="form-group">
            <label>Season Folder Format</label>
            <input type="text" id="modal-season-format" class="form-control" value="${escapeHtml(show.season_format)}">
            <small class="text-muted">Variables: {season}</small>
        </div>
        <div class="form-group">
            <label>Episode Format</label>
            <input type="text" id="modal-episode-format" class="form-control" value="${escapeHtml(show.episode_format)}">
            <small class="text-muted">Variables: {season}, {episode}, {title}</small>
        </div>
        <div class="form-group">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="checkbox" id="modal-do-rename" ${show.do_rename ? 'checked' : ''}>
                Enable renaming for this show
            </label>
        </div>
        <div class="form-group">
            <label style="display: flex; align-items: center; gap: 10px; cursor: pointer;">
                <input type="checkbox" id="modal-do-missing" ${show.do_missing ? 'checked' : ''}>
                Track missing episodes
            </label>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveShowSettings(${showId})">Save</button>
        </div>
    `;

    modal.classList.add('active');
}

async function saveShowSettings(showId) {
    const folderPath = document.getElementById('modal-folder-path').value.trim();
    const seasonFormat = document.getElementById('modal-season-format').value.trim();
    const episodeFormat = document.getElementById('modal-episode-format').value.trim();
    const doRename = document.getElementById('modal-do-rename').checked;
    const doMissing = document.getElementById('modal-do-missing').checked;

    try {
        await api(`/shows/${showId}`, {
            method: 'PUT',
            body: JSON.stringify({
                folder_path: folderPath || null,
                season_format: seasonFormat,
                episode_format: episodeFormat,
                do_rename: doRename,
                do_missing: doMissing
            })
        });
        showToast('Settings updated', 'success');
        closeModal();
        showShowDetail(showId);
    } catch (error) {
        // Error already shown
    }
}

// Add Show Modal
function showAddShowModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Add Show';
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Search TMDB</label>
            <input type="text" id="show-search-input" class="form-control" placeholder="Enter show name..." onkeyup="debounceSearch(event)">
        </div>
        <div class="form-group">
            <label class="checkbox-label">
                <input type="checkbox" id="scan-library-checkbox" checked>
                <span>This show is in my library</span>
            </label>
            <small class="text-muted">When checked, will scan your library folders to find and match episodes</small>
        </div>
        <div id="search-results" class="search-results"></div>
    `;

    modal.classList.add('active');
}

let searchTimeout;
function debounceSearch(event) {
    clearTimeout(searchTimeout);
    const query = event.target.value.trim();

    if (query.length < 2) {
        document.getElementById('search-results').innerHTML = '';
        return;
    }

    searchTimeout = setTimeout(() => searchShows(query), 300);
}

async function searchShows(query) {
    const resultsDiv = document.getElementById('search-results');
    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const data = await api(`/shows/search/tmdb?q=${encodeURIComponent(query)}`);

        if (data.results.length === 0) {
            resultsDiv.innerHTML = '<p class="text-muted text-center">No results found.</p>';
            return;
        }

        resultsDiv.innerHTML = data.results.slice(0, 10).map(show => `
            <div class="search-result-item" onclick="addShowFromSearch(${show.id})">
                <img src="${show.poster_path ? TMDB_IMAGE_BASE + show.poster_path : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'}"
                     class="search-result-poster"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'">
                <div class="search-result-info">
                    <h4>${escapeHtml(show.name)}</h4>
                    <p>${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                    <p>${escapeHtml((show.overview || '').substring(0, 100))}${(show.overview || '').length > 100 ? '...' : ''}</p>
                </div>
            </div>
        `).join('');
    } catch (error) {
        resultsDiv.innerHTML = '<p class="text-muted text-center">Search failed.</p>';
    }
}

async function addShowFromSearch(tmdbId) {
    // Check if we should scan library
    const scanLibraryCheckbox = document.getElementById('scan-library-checkbox');
    const shouldScanLibrary = scanLibraryCheckbox ? scanLibraryCheckbox.checked : false;

    closeModal();

    try {
        showToast('Adding show...', 'info');
        const newShow = await api('/shows', {
            method: 'POST',
            body: JSON.stringify({ tmdb_id: tmdbId })
        });
        showToast('Show added successfully', 'success');

        // If checkbox was checked, scan library to find and match episodes
        if (shouldScanLibrary && newShow.id) {
            await scanWithProgress(newShow.id);
        } else {
            navigateTo('shows');
        }
    } catch (error) {
        // Error already shown
    }
}

function showScanningModal(showName) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Scanning Library';
    modalBody.innerHTML = `
        <div class="scanning-progress">
            <div class="scanning-spinner"></div>
            <p class="scanning-status" id="scan-status-text">Scanning for episodes...</p>
            <p class="scanning-show">${escapeHtml(showName)}</p>
            <div class="progress-bar-container">
                <div class="progress-bar" id="scan-progress-bar"></div>
            </div>
            <p class="scanning-details text-muted" id="scan-details"></p>
        </div>
    `;

    // Remove close button during scan
    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');
}

function updateScanningModal(status, details = '') {
    const statusText = document.getElementById('scan-status-text');
    const detailsText = document.getElementById('scan-details');
    const progressBar = document.getElementById('scan-progress-bar');

    if (statusText) statusText.textContent = status;
    if (detailsText) detailsText.textContent = details;
    if (progressBar) {
        progressBar.style.width = '100%';
        progressBar.classList.add('animated');
    }
}

function closeScanningModal() {
    document.querySelector('.modal-close').style.display = '';
    closeModal();
}

async function scanWithProgress(showId) {
    // Get show name for display
    const show = await api(`/shows/${showId}`);
    showScanningModal(show.name);

    // Trigger scan
    await api('/scan', { method: 'POST' });

    // Poll for completion
    let attempts = 0;
    const maxAttempts = 60; // 30 seconds max

    const checkStatus = async () => {
        attempts++;
        try {
            const status = await api('/scan/status');

            if (status.running) {
                updateScanningModal('Scanning...', status.message || '');
                if (attempts < maxAttempts) {
                    setTimeout(checkStatus, 500);
                } else {
                    updateScanningModal('Scan taking longer than expected...');
                    setTimeout(checkStatus, 1000);
                }
            } else {
                // Scan complete
                if (status.result) {
                    const r = status.result;
                    updateScanningModal(
                        'Scan complete!',
                        `Found ${r.episodes_matched || 0} episodes`
                    );
                }

                // Wait a moment for database to fully commit, then close and show results
                setTimeout(() => {
                    closeScanningModal();
                    showShowDetail(showId);
                }, 1500);
            }
        } catch (error) {
            closeScanningModal();
            showShowDetail(showId);
        }
    };

    // Start polling after a brief delay
    setTimeout(checkStatus, 500);
}

// Refresh Results Modal
function showRefreshResultsModal(status) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const completedCount = status.completed?.length || 0;
    const errorCount = status.errors?.length || 0;

    modalTitle.textContent = 'Metadata Refresh Complete';

    let successListHtml = '';
    if (completedCount > 0) {
        successListHtml = `
            <div id="refresh-success-section" class="refresh-section refresh-success" style="display: none;">
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
            <div id="refresh-error-section" class="refresh-section refresh-errors" style="display: none;">
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

    let html = `
        <div class="refresh-results">
            <div class="refresh-summary">
                <div class="refresh-stat refresh-stat-success ${completedCount > 0 ? 'clickable' : ''}" id="refresh-tab-success" ${completedCount > 0 ? 'onclick="toggleRefreshFilter(\'success\')"' : ''}>
                    <span class="refresh-stat-number">${completedCount}</span>
                    <span class="refresh-stat-label">Successful</span>
                </div>
                <div class="refresh-stat refresh-stat-error ${errorCount > 0 ? 'clickable' : ''}" id="refresh-tab-error" ${errorCount > 0 ? 'onclick="toggleRefreshFilter(\'error\')"' : ''}>
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

    modalBody.innerHTML = html;
    modal.classList.add('active');
}

function toggleRefreshFilter(filter) {
    const successSection = document.getElementById('refresh-success-section');
    const errorSection = document.getElementById('refresh-error-section');
    const successTab = document.getElementById('refresh-tab-success');
    const errorTab = document.getElementById('refresh-tab-error');

    if (filter === 'success' && successSection) {
        const isVisible = successSection.style.display !== 'none';
        successSection.style.display = isVisible ? 'none' : 'block';
        successTab.classList.toggle('active', !isVisible);
        // Hide the other section
        if (errorSection) {
            errorSection.style.display = 'none';
            errorTab.classList.remove('active');
        }
    } else if (filter === 'error' && errorSection) {
        const isVisible = errorSection.style.display !== 'none';
        errorSection.style.display = isVisible ? 'none' : 'block';
        errorTab.classList.toggle('active', !isVisible);
        // Hide the other section
        if (successSection) {
            successSection.style.display = 'none';
            successTab.classList.remove('active');
        }
    }
}

function closeModal() {
    document.getElementById('modal').classList.remove('active');
}

// Scan
async function renderScan() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [actions, scanStatus, missingEpisodes, settings] = await Promise.all([
            api('/actions'),
            api('/scan/status'),
            api('/scan/missing'),
            api('/settings')
        ]);
        state.actions = actions;
        state.settings = settings;
        const displayEpFormat = settings?.display_episode_format || '{season}x{episode:02d}';

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Scan</h1>
            </div>

            <!-- Scan Buttons -->
            <div class="card mb-20">
                <div class="card-header">
                    <h3 class="card-title">Scan Operations</h3>
                </div>
                <div class="scan-buttons">
                    <div class="scan-button-group">
                        <button class="btn btn-primary btn-lg" onclick="triggerFullScan()" id="scan-full-btn" ${scanStatus.running ? 'disabled' : ''}>
                            Full Scan
                        </button>
                        <p class="scan-description">Scan all shows for updates, missing episodes, and check downloads folder.</p>
                    </div>
                    <div class="scan-button-group">
                        <button class="btn btn-secondary btn-lg" onclick="triggerQuickScan()" id="scan-quick-btn" ${scanStatus.running ? 'disabled' : ''}>
                            Quick Scan
                        </button>
                        <p class="scan-description">Scan shows with recently aired episodes (${settings.recently_aired_days || 5} days).</p>
                    </div>
                    <div class="scan-button-group">
                        <button class="btn btn-secondary btn-lg" onclick="triggerOngoingScan()" id="scan-ongoing-btn" ${scanStatus.running ? 'disabled' : ''}>
                            Ongoing Scan
                        </button>
                        <p class="scan-description">Scan only ongoing shows (not canceled/ended).</p>
                    </div>
                    <div class="scan-button-group">
                        <button class="btn btn-secondary btn-lg" onclick="triggerScanSelected()" id="scan-selected-btn" ${scanStatus.running ? 'disabled' : ''}>
                            Scan Selected
                        </button>
                        <p class="scan-description">Scan only selected episodes from the Missing Episodes list below.</p>
                    </div>
                </div>
            </div>

            <!-- Results Area -->
            <div class="card" id="scan-results-card">
                <div class="card-header flex flex-between">
                    <h3 class="card-title" id="results-title">
                        ${scanStatus.running ? 'Scanning...' :
                          actions.length > 0 ? 'Pending Actions' :
                          missingEpisodes.length > 0 ? 'Missing Episodes' : 'Results'}
                    </h3>
                    ${actions.length > 0 && !scanStatus.running ? `
                        <button class="btn btn-success" onclick="approveAllActions()">Approve All</button>
                    ` : ''}
                </div>
                <div id="scan-results-content">
                    ${scanStatus.running ? `
                        <div class="scan-progress-area">
                            <div class="scan-progress-spinner"></div>
                            <div class="scan-progress-text">${escapeHtml(scanStatus.message || 'Scanning...')}</div>
                            <div class="progress-bar-container mt-10">
                                <div class="progress-bar-fill" style="width: ${scanStatus.progress}%"></div>
                            </div>
                        </div>
                    ` : actions.length > 0 ? `
                        <div class="actions-list">
                            ${actions.map(action => `
                                <div class="action-item">
                                    <div class="action-item-info">
                                        <strong>${escapeHtml(action.show_name || 'Unknown Show')} - ${action.season != null ? formatEpisodeCode(action.season, action.episode, displayEpFormat) : escapeHtml(action.episode_code || '')}</strong>
                                        <div class="action-item-path" title="${escapeHtml(action.source_path)}">
                                            From: ${escapeHtml(action.source_path)}
                                        </div>
                                        <div class="action-item-path" title="${escapeHtml(action.dest_path || '')}">
                                            To: ${escapeHtml(action.dest_path || '')}
                                        </div>
                                    </div>
                                    <div class="action-item-buttons">
                                        <button class="btn btn-sm btn-success" onclick="approveAction(${action.id})">Approve</button>
                                        <button class="btn btn-sm btn-danger" onclick="rejectAction(${action.id})">Reject</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    ` : missingEpisodes.length > 0 ? `
                        <div class="missing-episodes-toolbar">
                            <div class="missing-toolbar-left">
                                <span class="missing-selected-count" id="missing-selected-count">0 selected</span>
                                <button class="missing-toolbar-btn btn-primary" onclick="showFixMatchModal()" id="btn-fix-match" disabled>Fix Match</button>
                                <button class="missing-toolbar-btn btn-warning" onclick="ignoreSelectedEpisodes()" id="btn-ignore" disabled>Ignore</button>
                                <button class="missing-toolbar-btn" onclick="markSelectedAsSpecials()" id="btn-specials" disabled>Specials</button>
                            </div>
                            <div class="missing-toolbar-right">
                                <button class="missing-toolbar-btn" onclick="toggleAllMissingGroups(true)">Expand All</button>
                                <button class="missing-toolbar-btn" onclick="toggleAllMissingGroups(false)">Collapse All</button>
                            </div>
                        </div>
                        <div class="missing-episodes-grouped">
                            ${missingEpisodes.map(show => {
                                const isCollapsed = getMissingGroupCollapseState(show.show_id);
                                return `
                                <div class="missing-show-group" data-show-id="${show.show_id}">
                                    <div class="missing-show-header" onclick="toggleMissingShowGroup(this, ${show.show_id})">
                                        <span class="missing-show-chevron">${isCollapsed ? '&#9654;' : '&#9660;'}</span>
                                        <span class="missing-show-name">${escapeHtml(show.show_name)}</span>
                                        <span class="missing-show-count">(${show.episodes.length} ${show.episodes.length === 1 ? 'item' : 'items'})</span>
                                    </div>
                                    <div class="missing-episodes-table-wrapper ${isCollapsed ? '' : 'open'}">
                                        <table class="missing-episodes-table">
                                            <thead>
                                                <tr>
                                                    <th class="checkbox-col"><input type="checkbox" onclick="toggleAllMissingInShow(this, ${show.show_id})" title="Select all"></th>
                                                    <th>Season</th>
                                                    <th>Episode</th>
                                                    <th>Air Date</th>
                                                    <th>Filename</th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                ${show.episodes.map(ep => `
                                                    <tr class="missing-episode-row">
                                                        <td class="checkbox-col"><input type="checkbox" class="episode-checkbox" data-show-id="${show.show_id}" data-episode-id="${ep.id}" data-show-name="${escapeHtml(show.show_name)}" onclick="event.stopPropagation(); updateMissingSelectionCount()"></td>
                                                        <td>${ep.season}</td>
                                                        <td>${ep.episode}</td>
                                                        <td>${ep.air_date || '-'}</td>
                                                        <td class="filename-cell">
                                                            <div class="filename-line" onclick="showShowDetail(${show.show_id}, ${ep.season}, ${ep.episode})" title="${escapeHtml(ep.expected_filename)}">${escapeHtml(ep.expected_filename)}</div>
                                                            <div class="folder-line" title="${escapeHtml(ep.expected_folder)}">${escapeHtml(ep.expected_folder)}</div>
                                                        </td>
                                                    </tr>
                                                `).join('')}
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                            `}).join('')}
                        </div>
                    ` : `
                        <div class="empty-state" style="padding: 40px 20px;">
                            <div class="empty-state-icon">✓</div>
                            <h3>All Caught Up</h3>
                            <p>No pending actions or missing episodes. Your library is complete!</p>
                        </div>
                    `}
                </div>
            </div>
        `;
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load scan page.</div>`;
    }
}

// Scan with live progress updates
async function triggerFullScan() {
    try {
        await api('/scan', { method: 'POST' });
        showToast('Full scan started', 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

async function triggerQuickScan() {
    try {
        const result = await api('/scan/quick', { method: 'POST' });
        showToast(`Quick scan started (${result.days} days)`, 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

async function triggerOngoingScan() {
    try {
        await api('/scan/ongoing', { method: 'POST' });
        showToast('Ongoing shows scan started', 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

function triggerScanSelected() {
    const selected = getSelectedMissingEpisodes();
    if (selected.length === 0) {
        // Scroll to missing episodes section and show a message
        const missingSection = document.querySelector('.missing-episodes-grouped');
        if (missingSection) {
            missingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast('Select episodes from the Missing Episodes list below, then click Scan Selected', 'info');
        } else {
            showToast('No missing episodes to scan', 'info');
        }
        return;
    }
    // If episodes are selected, run the scan
    scanSelectedEpisodes();
}

function pollScanStatusWithUI() {
    // Disable buttons
    const fullBtn = document.getElementById('scan-full-btn');
    const quickBtn = document.getElementById('scan-quick-btn');
    const ongoingBtn = document.getElementById('scan-ongoing-btn');
    const selectedBtn = document.getElementById('scan-selected-btn');
    if (fullBtn) fullBtn.disabled = true;
    if (quickBtn) quickBtn.disabled = true;
    if (ongoingBtn) ongoingBtn.disabled = true;
    if (selectedBtn) selectedBtn.disabled = true;

    // Update title
    const resultsTitle = document.getElementById('results-title');
    if (resultsTitle) resultsTitle.textContent = 'Scanning...';

    // Show progress in results area
    const resultsContent = document.getElementById('scan-results-content');
    if (resultsContent) {
        resultsContent.innerHTML = `
            <div class="scan-progress-area">
                <div class="scan-progress-spinner"></div>
                <div class="scan-progress-text" id="scan-status-text">Starting scan...</div>
                <div class="progress-bar-container mt-10">
                    <div class="progress-bar-fill" id="scan-progress-bar" style="width: 0%"></div>
                </div>
            </div>
        `;
    }

    const checkStatus = async () => {
        try {
            const status = await api('/scan/status');
            const statusText = document.getElementById('scan-status-text');
            const progressBar = document.getElementById('scan-progress-bar');

            if (status.running) {
                if (statusText) statusText.textContent = status.message || 'Scanning...';
                if (progressBar) progressBar.style.width = `${status.progress}%`;
                setTimeout(checkStatus, 1000);
            } else {
                // Scan complete - refresh the page
                if (status.result?.error) {
                    showToast(`Scan failed: ${status.result.error}`, 'error');
                } else {
                    showToast('Scan completed', 'success');
                }
                renderScan();
            }
        } catch (error) {
            // Silently fail and retry
            setTimeout(checkStatus, 2000);
        }
    };

    setTimeout(checkStatus, 500);
}

async function approveAction(actionId) {
    try {
        await api(`/actions/${actionId}/approve`, { method: 'POST' });
        showToast('Action approved and executed', 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

async function rejectAction(actionId) {
    try {
        await api(`/actions/${actionId}/reject`, { method: 'POST' });
        showToast('Action rejected', 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

async function approveAllActions() {
    if (!confirm('Approve and execute all pending actions?')) {
        return;
    }

    try {
        const result = await api('/actions/approve-all', { method: 'POST' });
        showToast(`${result.success} actions completed, ${result.failed} failed`, result.failed > 0 ? 'warning' : 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

// Settings
async function renderSettings() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [settings, folders] = await Promise.all([
            api('/settings'),
            api('/folders')
        ]);

        state.settings = settings;
        state.folders = folders;

        // Store original values for reset functionality
        state.originalSettings = { ...settings };

        const libraryFolders = folders.filter(f => f.type === 'library');
        const downloadFolders = folders.filter(f => f.type === 'download');

        const currentTheme = settings.theme || 'midnight';

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Settings</h1>
            </div>

            <div class="card">
                <h2 class="card-title mb-20">Appearance</h2>
                <div class="theme-selector">
                    <div class="theme-option ${currentTheme === 'midnight' ? 'active' : ''}" data-theme="midnight" onclick="updateTheme('midnight')">
                        <div class="theme-preview">
                            <div class="theme-swatch" style="background: #1a1a2e;"></div>
                            <div class="theme-swatch" style="background: #252542;"></div>
                            <div class="theme-swatch" style="background: #3498db;"></div>
                        </div>
                        <div class="theme-name">Midnight</div>
                    </div>
                    <div class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" onclick="updateTheme('dark')">
                        <div class="theme-preview">
                            <div class="theme-swatch" style="background: #0a0a0a;"></div>
                            <div class="theme-swatch" style="background: #111111;"></div>
                            <div class="theme-swatch" style="background: #e67e22;"></div>
                        </div>
                        <div class="theme-name">OLED Dark</div>
                    </div>
                    <div class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light" onclick="updateTheme('light')">
                        <div class="theme-preview">
                            <div class="theme-swatch" style="background: #f5f5f5;"></div>
                            <div class="theme-swatch" style="background: #ffffff;"></div>
                            <div class="theme-swatch" style="background: #3498db;"></div>
                        </div>
                        <div class="theme-name">Light</div>
                    </div>
                </div>
            </div>

            <div class="card">
                <h2 class="card-title mb-20">TMDB API</h2>
                <div class="form-group">
                    <label>API Key ${settings.tmdb_api_key_set ? '<span class="badge badge-success">Set</span>' : '<span class="badge badge-danger">Not Set</span>'}</label>
                    <input type="password" id="settings-api-key" class="form-control" placeholder="${settings.tmdb_api_key_set ? '••••••••' : 'Enter API key'}">
                </div>
                <button class="btn btn-primary" onclick="updateApiKey()">Update API Key</button>
            </div>

            <div class="card">
                <h2 class="card-title mb-20">Naming Formats</h2>
                <div class="form-group">
                    <label>Episode Filename Format</label>
                    <input type="text" id="settings-episode-format" class="form-control" value="${escapeHtml(settings.episode_format)}" oninput="updateFormatPreviews(); markSettingsChanged('formats')">
                    <div class="format-preview">Preview: <strong id="preview-episode-format"></strong></div>
                    <small class="text-muted">
                        Variables: <code>{season}</code>, <code>{episode}</code>, <code>{title}</code><br>
                        Add <code>:02d</code> for zero-padding (e.g., <code>{episode:02d}</code> = 04 instead of 4)
                    </small>
                </div>
                <div class="form-group">
                    <label>Season Folder Format</label>
                    <input type="text" id="settings-season-format" class="form-control" value="${escapeHtml(settings.season_format)}" oninput="updateFormatPreviews(); markSettingsChanged('formats')">
                    <div class="format-preview">Preview: <strong id="preview-season-format"></strong></div>
                    <small class="text-muted">
                        Variables: <code>{season}</code><br>
                        Add <code>:02d</code> for zero-padding (e.g., <code>{season:02d}</code> = 04 instead of 4)
                    </small>
                </div>
                <div class="settings-buttons">
                    <button class="btn btn-primary" onclick="updateFormats()">Save Formats</button>
                    <button class="btn btn-secondary" onclick="resetFormats()" id="reset-formats-btn" style="display: none;">Reset</button>
                </div>
            </div>

            <div class="card">
                <h2 class="card-title mb-20">Dashboard Display</h2>
                <div class="dashboard-settings-grid">
                    <div class="dashboard-setting-item">
                        <label>Upcoming Episodes</label>
                        <select id="settings-upcoming-days" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.upcoming_days, '{n} Days ahead')}
                        </select>
                    </div>
                    <div class="dashboard-setting-item">
                        <label>Recently Aired</label>
                        <select id="settings-recently-aired-days" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.recently_aired_days, '{n} Days back')}
                        </select>
                    </div>
                    <div class="dashboard-setting-item">
                        <label>Recently Added</label>
                        <select id="settings-recently-added-count" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.recently_added_count, '{n} Shows')}
                        </select>
                    </div>
                    <div class="dashboard-setting-item">
                        <label>Recently Matched</label>
                        <select id="settings-recently-matched-count" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.recently_matched_count, '{n} Episodes')}
                        </select>
                    </div>
                    <div class="dashboard-setting-item">
                        <label>Returning Soon</label>
                        <select id="settings-returning-soon-count" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.returning_soon_count, '{n} Shows')}
                        </select>
                    </div>
                    <div class="dashboard-setting-item">
                        <label>Recently Ended</label>
                        <select id="settings-recently-ended-count" class="form-control" onchange="markSettingsChanged('dashboard')">
                            ${generateSelectOptions(30, settings.recently_ended_count, '{n} Shows')}
                        </select>
                    </div>
                </div>
                <div class="dashboard-settings-divider"></div>
                <div class="form-group">
                    <label class="dashboard-setting-label">Episode Display Format</label>
                    <input type="text" id="settings-display-episode-format" class="form-control" value="${escapeHtml(settings.display_episode_format)}" oninput="updateFormatPreviews(); markSettingsChanged('dashboard')">
                    <div class="format-preview">Preview: <strong id="preview-display-episode-format"></strong></div>
                    <small class="text-muted">
                        Variables: <code>{season}</code>, <code>{episode}</code><br>
                        Add <code>:02d</code> for zero-padding (e.g., <code>{season:02d}</code> = 03, <code>{episode:02d}</code> = 04)
                    </small>
                </div>
                <div class="settings-buttons">
                    <button class="btn btn-primary" onclick="updateDashboardSettings()">Save Dashboard Settings</button>
                    <button class="btn btn-secondary" onclick="resetDashboardSettings()" id="reset-dashboard-btn" style="display: none;">Reset</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Library Folders</h2>
                    <button class="btn btn-sm btn-primary" onclick="showAddFolderModal('library')">+ Add Folder</button>
                </div>
                ${libraryFolders.length === 0 ? `
                    <p class="text-muted" id="library-folders-placeholder">No library folders configured.</p>
                ` : `
                    <table id="library-folders-table">
                        <thead>
                            <tr>
                                <th>Path</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${libraryFolders.map(folder => `
                                <tr data-folder-id="${folder.id}">
                                    <td>${escapeHtml(folder.path)}</td>
                                    <td class="folder-status"><span class="badge ${folder.enabled ? 'badge-success' : 'badge-warning'}">${folder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-primary" onclick="scanLibraryFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Scan</button>
                                        <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${folder.id})">${folder.enabled ? 'Disable' : 'Enable'}</button>
                                        <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Remove</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
                <div style="padding: 15px 15px 5px; border-top: 1px solid var(--border-color); margin-top: 10px;">
                    <div class="form-group" style="max-width: 250px; margin-bottom: 10px;">
                        <label>Slow Import Count</label>
                        <input type="number" id="settings-slow-import-count" class="form-control" value="${settings.slow_import_count || 10}" min="1" max="500">
                        <small class="text-muted">Number of shows to import per slow import batch</small>
                    </div>
                    <button class="btn btn-sm btn-primary" onclick="updateSlowImportCount()">Save</button>
                </div>
            </div>

            <div class="card">
                <div class="card-header">
                    <h2 class="card-title">Download Folders</h2>
                    <button class="btn btn-sm btn-primary" onclick="showAddFolderModal('download')">+ Add Folder</button>
                </div>
                ${downloadFolders.length === 0 ? `
                    <p class="text-muted" id="download-folders-placeholder">No download folders configured.</p>
                ` : `
                    <table id="download-folders-table">
                        <thead>
                            <tr>
                                <th>Path</th>
                                <th>Status</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${downloadFolders.map(folder => `
                                <tr data-folder-id="${folder.id}">
                                    <td>${escapeHtml(folder.path)}</td>
                                    <td class="folder-status"><span class="badge ${folder.enabled ? 'badge-success' : 'badge-warning'}">${folder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                                    <td>
                                        <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${folder.id})">${folder.enabled ? 'Disable' : 'Enable'}</button>
                                        <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Remove</button>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                `}
            </div>
        `;

        // Initialize format previews
        updateFormatPreviews();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load settings.</div>`;
    }
}

function updateFormatPreviews() {
    // Sample data for previews
    const sampleSeason = 3;
    const sampleEpisode = 4;
    const sampleTitle = "The One Where They Code";

    // Helper to apply format
    const applyFormat = (format, vars) => {
        let result = format;
        for (const [key, value] of Object.entries(vars)) {
            // Handle :02d padding
            result = result.replace(new RegExp(`\\{${key}:02d\\}`, 'g'), String(value).padStart(2, '0'));
            result = result.replace(new RegExp(`\\{${key}:03d\\}`, 'g'), String(value).padStart(3, '0'));
            // Handle plain variable
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        return result;
    };

    // Episode format preview
    const episodeFormatInput = document.getElementById('settings-episode-format');
    const episodePreview = document.getElementById('preview-episode-format');
    if (episodeFormatInput && episodePreview) {
        const format = episodeFormatInput.value || '{season}x{episode:02d} - {title}';
        episodePreview.textContent = applyFormat(format, {
            season: sampleSeason,
            episode: sampleEpisode,
            title: sampleTitle
        });
    }

    // Season folder format preview
    const seasonFormatInput = document.getElementById('settings-season-format');
    const seasonPreview = document.getElementById('preview-season-format');
    if (seasonFormatInput && seasonPreview) {
        const format = seasonFormatInput.value || 'Season {season}';
        seasonPreview.textContent = applyFormat(format, {
            season: sampleSeason
        });
    }

    // Episode display format preview
    const displayFormatInput = document.getElementById('settings-display-episode-format');
    const displayPreview = document.getElementById('preview-display-episode-format');
    if (displayFormatInput && displayPreview) {
        const format = displayFormatInput.value || '{season}x{episode:02d}';
        displayPreview.textContent = applyFormat(format, {
            season: sampleSeason,
            episode: sampleEpisode
        });
    }
}

// Track unsaved changes in settings
const settingsChanged = {
    formats: false,
    dashboard: false
};

function markSettingsChanged(section) {
    settingsChanged[section] = true;
    const resetBtn = document.getElementById(`reset-${section}-btn`);
    if (resetBtn) {
        resetBtn.style.display = 'inline-block';
    }
}

function hasUnsavedSettings() {
    return settingsChanged.formats || settingsChanged.dashboard;
}

function clearSettingsChanged(section) {
    settingsChanged[section] = false;
    const resetBtn = document.getElementById(`reset-${section}-btn`);
    if (resetBtn) {
        resetBtn.style.display = 'none';
    }
    // Update original settings to current values
    if (state.originalSettings && state.settings) {
        if (section === 'formats') {
            state.originalSettings.episode_format = state.settings.episode_format;
            state.originalSettings.season_format = state.settings.season_format;
        } else if (section === 'dashboard') {
            state.originalSettings.upcoming_days = state.settings.upcoming_days;
            state.originalSettings.recently_aired_days = state.settings.recently_aired_days;
            state.originalSettings.display_episode_format = state.settings.display_episode_format;
        }
    }
}

function resetFormats() {
    if (!state.originalSettings) return;

    document.getElementById('settings-episode-format').value = state.originalSettings.episode_format;
    document.getElementById('settings-season-format').value = state.originalSettings.season_format;

    updateFormatPreviews();
    settingsChanged.formats = false;
    document.getElementById('reset-formats-btn').style.display = 'none';
    showToast('Formats reset to saved values', 'info');
}

function resetDashboardSettings() {
    if (!state.originalSettings) return;

    document.getElementById('settings-upcoming-days').value = state.originalSettings.upcoming_days;
    document.getElementById('settings-recently-aired-days').value = state.originalSettings.recently_aired_days;
    document.getElementById('settings-recently-added-count').value = state.originalSettings.recently_added_count;
    document.getElementById('settings-recently-matched-count').value = state.originalSettings.recently_matched_count;
    document.getElementById('settings-returning-soon-count').value = state.originalSettings.returning_soon_count;
    document.getElementById('settings-recently-ended-count').value = state.originalSettings.recently_ended_count;
    document.getElementById('settings-display-episode-format').value = state.originalSettings.display_episode_format;

    updateFormatPreviews();
    settingsChanged.dashboard = false;
    document.getElementById('reset-dashboard-btn').style.display = 'none';
    showToast('Dashboard settings reset to saved values', 'info');
}

async function updateApiKey() {
    const apiKey = document.getElementById('settings-api-key').value.trim();
    if (!apiKey) {
        showToast('Please enter an API key', 'warning');
        return;
    }

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdb_api_key: apiKey })
        });
        showToast('API key updated', 'success');
        renderSettings();
    } catch (error) {
        // Error already shown
    }
}

async function updateFormats() {
    const episodeFormat = document.getElementById('settings-episode-format').value.trim();
    const seasonFormat = document.getElementById('settings-season-format').value.trim();

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({
                episode_format: episodeFormat,
                season_format: seasonFormat
            })
        });
        // Update state with new values
        state.settings.episode_format = episodeFormat;
        state.settings.season_format = seasonFormat;
        clearSettingsChanged('formats');
        showToast('Formats updated', 'success');
    } catch (error) {
        // Error already shown
    }
}

async function updateDashboardSettings() {
    const upcomingDays = parseInt(document.getElementById('settings-upcoming-days').value) || 5;
    const recentlyAiredDays = parseInt(document.getElementById('settings-recently-aired-days').value) || 5;
    const recentlyAddedCount = parseInt(document.getElementById('settings-recently-added-count').value) || 5;
    const recentlyMatchedCount = parseInt(document.getElementById('settings-recently-matched-count').value) || 5;
    const returningSoonCount = parseInt(document.getElementById('settings-returning-soon-count').value) || 5;
    const recentlyEndedCount = parseInt(document.getElementById('settings-recently-ended-count').value) || 5;
    const displayEpisodeFormat = document.getElementById('settings-display-episode-format').value.trim() || '{season}x{episode:02d}';

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({
                upcoming_days: upcomingDays,
                recently_aired_days: recentlyAiredDays,
                recently_added_count: recentlyAddedCount,
                recently_matched_count: recentlyMatchedCount,
                returning_soon_count: returningSoonCount,
                recently_ended_count: recentlyEndedCount,
                display_episode_format: displayEpisodeFormat
            })
        });
        // Update state so dashboard reflects changes immediately
        state.settings.upcoming_days = upcomingDays;
        state.settings.recently_aired_days = recentlyAiredDays;
        state.settings.recently_added_count = recentlyAddedCount;
        state.settings.recently_matched_count = recentlyMatchedCount;
        state.settings.returning_soon_count = returningSoonCount;
        state.settings.recently_ended_count = recentlyEndedCount;
        state.settings.display_episode_format = displayEpisodeFormat;
        clearSettingsChanged('dashboard');
        showToast('Dashboard settings updated', 'success');
    } catch (error) {
        // Error already shown
    }
}

async function updateSlowImportCount() {
    const count = parseInt(document.getElementById('settings-slow-import-count').value) || 10;
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ slow_import_count: count })
        });
        state.settings.slow_import_count = count;
        showToast('Slow import count updated', 'success');
    } catch (error) {
        // Error already shown
    }
}

function showAddFolderModal(folderType) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = `Add ${folderType === 'library' ? 'Library' : 'Download'} Folder`;
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Folder Path</label>
            <input type="text" id="new-folder-path" class="form-control" placeholder="/path/to/folder">
        </div>
        <button class="btn btn-primary" onclick="addFolder('${folderType}')">Add Folder</button>
    `;

    modal.classList.add('active');
}

async function addFolder(folderType) {
    const path = document.getElementById('new-folder-path').value.trim();
    if (!path) {
        showToast('Please enter a folder path', 'warning');
        return;
    }

    try {
        const newFolder = await api('/folders', {
            method: 'POST',
            body: JSON.stringify({ path, type: folderType })
        });

        // Close modal first so user sees immediate feedback
        closeModal();

        // Add to state
        state.folders.push(newFolder);

        // Find the appropriate table or placeholder
        const tableId = folderType === 'library' ? 'library-folders-table' : 'download-folders-table';
        const placeholderId = folderType === 'library' ? 'library-folders-placeholder' : 'download-folders-placeholder';
        let table = document.getElementById(tableId);
        let placeholder = document.getElementById(placeholderId);

        // Create the new row HTML
        const newRowHtml = `
            <tr data-folder-id="${newFolder.id}">
                <td>${escapeHtml(newFolder.path)}</td>
                <td class="folder-status"><span class="badge ${newFolder.enabled ? 'badge-success' : 'badge-warning'}">${newFolder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                    <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${newFolder.id})">${newFolder.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${newFolder.id}, '${escapeHtml(newFolder.path).replace(/'/g, "\\'")}')">Remove</button>
                </td>
            </tr>
        `;

        if (table) {
            // Table exists, add the new row
            table.querySelector('tbody').insertAdjacentHTML('beforeend', newRowHtml);
        } else if (placeholder) {
            // No table yet, create it replacing the placeholder
            const tableHtml = `
                <table id="${tableId}">
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${newRowHtml}
                    </tbody>
                </table>
            `;
            placeholder.outerHTML = tableHtml;
        }

        showToast('Folder added', 'success');
    } catch (error) {
        // Error already shown
    }
}

async function toggleFolder(folderId) {
    try {
        const updatedFolder = await api(`/folders/${folderId}/toggle`, { method: 'PUT' });

        // Update the folder in state
        const folderIndex = state.folders.findIndex(f => f.id === folderId);
        if (folderIndex !== -1) {
            state.folders[folderIndex] = updatedFolder;
        }

        // Update just the row in the table
        const row = document.querySelector(`tr[data-folder-id="${folderId}"]`);
        if (row) {
            const statusCell = row.querySelector('.folder-status');
            const toggleBtn = row.querySelector('.folder-toggle-btn');

            if (statusCell) {
                statusCell.innerHTML = `<span class="badge ${updatedFolder.enabled ? 'badge-success' : 'badge-warning'}">${updatedFolder.enabled ? 'Enabled' : 'Disabled'}</span>`;
            }
            if (toggleBtn) {
                toggleBtn.textContent = updatedFolder.enabled ? 'Disable' : 'Enable';
            }
        }

        showToast(`Folder ${updatedFolder.enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
        // Error already shown
    }
}

function confirmDeleteFolder(folderId, folderPath) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Remove Folder';
    modalBody.innerHTML = `
        <p>Are you sure you want to remove this folder?</p>
        <p class="text-muted" style="word-break: break-all;">${escapeHtml(folderPath)}</p>
        <div class="modal-buttons">
            <button class="btn btn-danger" onclick="deleteFolder(${folderId})">Remove</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;

    modal.classList.add('active');
}

async function deleteFolder(folderId) {
    try {
        await api(`/folders/${folderId}`, { method: 'DELETE' });

        // Remove from state
        state.folders = state.folders.filter(f => f.id !== folderId);

        // Remove the row from the table
        const row = document.querySelector(`tr[data-folder-id="${folderId}"]`);
        if (row) {
            row.remove();
        }

        // Check if the table is now empty and show "No folders" message
        const libraryTable = document.getElementById('library-folders-table');
        const downloadTable = document.getElementById('download-folders-table');

        if (libraryTable && libraryTable.querySelectorAll('tbody tr').length === 0) {
            libraryTable.outerHTML = '<p class="text-muted" id="library-folders-placeholder">No library folders configured.</p>';
        }
        if (downloadTable && downloadTable.querySelectorAll('tbody tr').length === 0) {
            downloadTable.outerHTML = '<p class="text-muted" id="download-folders-placeholder">No download folders configured.</p>';
        }

        closeModal();
        showToast('Folder removed', 'success');
    } catch (error) {
        // Error already shown
    }
}

// Slow Import - import a configured number of shows from library folder
async function startSlowImport() {
    try {
        // Fetch settings and folders
        const [settings, folders] = await Promise.all([
            api('/settings'),
            api('/folders')
        ]);

        const slowImportCount = settings.slow_import_count || 10;
        const libraryFolders = folders.filter(f => f.type === 'library' && f.enabled);

        if (libraryFolders.length === 0) {
            showToast('No library folders configured. Add one in Settings.', 'warning');
            return;
        }

        const folder = libraryFolders[0];
        showLibraryFolderScanModal(folder.path);

        // Start scan with limit
        await api('/scan/library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_id: folder.id, limit: slowImportCount })
        });

        pollLibraryFolderScanStatus();
    } catch (error) {
        closeLibraryFolderScanModal();
        // Error already shown by api()
    }
}

// Library Folder Discovery Scan
async function scanLibraryFolder(folderId, folderPath) {
    // Show the scanning modal
    showLibraryFolderScanModal(folderPath);

    try {
        // Start the scan
        await api('/scan/library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_id: folderId })
        });

        // Poll for status updates
        pollLibraryFolderScanStatus();
    } catch (error) {
        closeLibraryFolderScanModal();
        // Error already shown by api()
    }
}

function showLibraryFolderScanModal(folderPath) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Scanning Library Folder';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-header">
                <div class="library-scan-folder" title="${escapeHtml(folderPath)}">${escapeHtml(folderPath)}</div>
                <div class="library-scan-status">
                    <div class="library-scan-spinner"></div>
                    <span id="library-scan-message">Initializing...</span>
                </div>
                <div class="library-scan-progress-container">
                    <div class="library-scan-progress-bar" id="library-scan-progress" style="width: 0%"></div>
                </div>
            </div>
            <div class="library-scan-stats" id="library-scan-stats">
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-found">0</span>
                    <span class="library-scan-stat-label">Found</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-added">0</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-skipped">0</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-matched">0</span>
                    <span class="library-scan-stat-label">Episodes</span>
                </div>
            </div>
            <div class="library-scan-current" id="library-scan-current"></div>
            <div class="library-scan-console" id="library-scan-console">
                <div class="console-placeholder">Waiting for scan to start...</div>
            </div>
        </div>
    `;

    // Hide close button during scan
    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');
}

function updateLibraryFolderScanModal(status) {
    // Update message
    const messageEl = document.getElementById('library-scan-message');
    if (messageEl) messageEl.textContent = status.message || 'Scanning...';

    // Update progress bar
    const progressEl = document.getElementById('library-scan-progress');
    if (progressEl) progressEl.style.width = `${status.progress || 0}%`;

    // Update stats
    const statFound = document.getElementById('stat-found');
    const statAdded = document.getElementById('stat-added');
    const statSkipped = document.getElementById('stat-skipped');
    const statMatched = document.getElementById('stat-matched');

    if (statFound) statFound.textContent = status.shows_found || 0;
    if (statAdded) statAdded.textContent = status.shows_added || 0;
    if (statSkipped) statSkipped.textContent = status.shows_skipped || 0;
    if (statMatched) statMatched.textContent = status.episodes_matched || 0;

    // Update current show
    const currentEl = document.getElementById('library-scan-current');
    if (currentEl) {
        if (status.current_show) {
            currentEl.textContent = `Processing: ${status.current_show}`;
            currentEl.style.display = 'block';
        } else {
            currentEl.style.display = 'none';
        }
    }

    // Update console
    const consoleEl = document.getElementById('library-scan-console');
    if (consoleEl && status.console && status.console.length > 0) {
        const entries = status.console.map(entry => {
            let levelClass = '';
            let icon = '';
            switch (entry.level) {
                case 'error':
                    levelClass = 'console-error';
                    icon = '✗';
                    break;
                case 'warning':
                    levelClass = 'console-warning';
                    icon = '⚠';
                    break;
                case 'success':
                    levelClass = 'console-success';
                    icon = '✓';
                    break;
                case 'skip':
                    levelClass = 'console-skip';
                    icon = '→';
                    break;
                default:
                    levelClass = 'console-info';
                    icon = '•';
            }
            return `<div class="console-entry ${levelClass}">
                <span class="console-time">${entry.time}</span>
                <span class="console-icon">${icon}</span>
                <span class="console-message">${escapeHtml(entry.message)}</span>
            </div>`;
        }).join('');

        consoleEl.innerHTML = entries;
        // Auto-scroll to bottom
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function closeLibraryFolderScanModal() {
    document.querySelector('.modal-close').style.display = '';
    closeModal();
}

// Store last scan status so minimized results can be restored
let _lastScanCompleteStatus = null;

function showLibraryFolderScanComplete(status) {
    _lastScanCompleteStatus = status;
    _renderScanCompleteModal(status);
    // Remove minimized indicator if present
    const indicator = document.getElementById('scan-results-indicator');
    if (indicator) indicator.remove();
}

function _renderScanCompleteModal(status) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const result = status.result || {};
    const showsProcessed = result.shows_processed || [];

    // Status icon/color helpers
    const statusDisplay = (show) => {
        if (show.status === 'added') {
            // Green check only if all episodes matched, red X if any missing
            if (show.total_episodes > 0 && show.episodes_matched < show.total_episodes) {
                return { icon: '✗', cls: 'console-error', label: 'Added (missing episodes)' };
            }
            return { icon: '✓', cls: 'console-success', label: 'Added' };
        }
        switch (show.status) {
            case 'existing': return { icon: '→', cls: 'console-skip', label: 'Existing' };
            case 'not_found': return { icon: '⚠', cls: 'console-warning', label: 'Not Found' };
            case 'error': return { icon: '✗', cls: 'console-error', label: 'Error' };
            default: return { icon: '•', cls: 'console-info', label: show.status };
        }
    };

    modalTitle.textContent = 'Scan Complete';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-complete-stats">
                <div class="library-scan-stat ${result.shows_added > 0 ? 'stat-highlight' : ''}">
                    <span class="library-scan-stat-value">${result.shows_added || 0}</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value">${result.shows_skipped || 0}</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat ${result.episodes_matched > 0 ? 'stat-highlight' : ''}">
                    <span class="library-scan-stat-value">${result.episodes_matched || 0}</span>
                    <span class="library-scan-stat-label">Episodes</span>
                </div>
            </div>
            ${showsProcessed.length > 0 ? `
                <div class="table-container" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px;">
                    <table style="font-size: 0.85rem;">
                        <thead>
                            <tr>
                                <th style="width: 30px;"></th>
                                <th>Show</th>
                                <th>Episodes</th>
                                <th>Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${showsProcessed.map(show => {
                                const sd = statusDisplay(show);
                                return `<tr>
                                    <td class="${sd.cls}" style="text-align: center; font-weight: bold;">${sd.icon}</td>
                                    <td>${escapeHtml(show.name)}</td>
                                    <td style="text-align: center;">${show.status === 'added' || show.episodes_matched > 0 ? show.episodes_matched : '—'}</td>
                                    <td class="text-muted" style="font-size: 0.8rem;">${escapeHtml(show.detail || sd.label)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            <div class="library-scan-actions">
                <button class="btn btn-primary" onclick="closeModal(); renderShowsList();">View Shows</button>
                <button class="btn btn-secondary" onclick="minimizeScanResults();">Minimize</button>
                <button class="btn btn-secondary" onclick="dismissScanResults(); closeModal();">Close</button>
            </div>
        </div>
    `;

    document.querySelector('.modal-close').style.display = '';
    modal.classList.add('active');
}

function minimizeScanResults() {
    closeModal();
    renderShowsList();

    // Don't add duplicate indicator
    if (document.getElementById('scan-results-indicator')) return;

    // Add indicator to sidebar
    const nav = document.querySelector('.nav-menu');
    const li = document.createElement('li');
    li.id = 'scan-results-indicator';
    li.innerHTML = `
        <a href="#" onclick="restoreScanResults(); return false;" style="color: var(--success-color);">
            <span class="nav-icon">&#x1F4CB;</span>
            Import Results
        </a>
    `;
    nav.appendChild(li);
}

function restoreScanResults() {
    if (_lastScanCompleteStatus) {
        _renderScanCompleteModal(_lastScanCompleteStatus);
    }
}

function dismissScanResults() {
    _lastScanCompleteStatus = null;
    const indicator = document.getElementById('scan-results-indicator');
    if (indicator) indicator.remove();
}

let libraryFolderScanPollTimer = null;

function pollLibraryFolderScanStatus() {
    const checkStatus = async () => {
        try {
            const status = await fetch(`${API_BASE}/scan/library-folder/status`).then(r => r.json());

            if (status.running) {
                updateLibraryFolderScanModal(status);
                libraryFolderScanPollTimer = setTimeout(checkStatus, 500);
            } else {
                // Scan complete
                updateLibraryFolderScanModal(status);

                // Short delay to show final state
                setTimeout(() => {
                    if (status.result && !status.result.error) {
                        showLibraryFolderScanComplete(status);
                    } else {
                        closeLibraryFolderScanModal();
                        if (status.result?.error) {
                            showToast(`Scan failed: ${status.result.error}`, 'error');
                        }
                    }
                }, 1000);
            }
        } catch (error) {
            closeLibraryFolderScanModal();
            showToast('Failed to get scan status', 'error');
        }
    };

    // Start polling
    libraryFolderScanPollTimer = setTimeout(checkStatus, 300);
}

// Scanning
async function triggerScan(type) {
    const endpoint = type === 'library' ? '/scan' : '/scan/downloads';

    try {
        await api(endpoint, { method: 'POST' });
        showToast(`${type === 'library' ? 'Library' : 'Download'} scan started`, 'info');

        // Poll for status
        pollScanStatus();
    } catch (error) {
        // Error already shown
    }
}

async function pollScanStatus() {
    const checkStatus = async () => {
        try {
            const status = await api('/scan/status');
            if (status.running) {
                setTimeout(checkStatus, 2000);
            } else if (status.result) {
                if (status.result.error) {
                    showToast(`Scan failed: ${status.result.error}`, 'error');
                } else {
                    showToast('Scan completed', 'success');
                    // Refresh current page
                    navigateTo(state.currentPage);
                }
            }
        } catch (error) {
            // Silently fail polling
        }
    };

    setTimeout(checkStatus, 1000);
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
            label = label.replace('Days', 'Day').replace('Shows', 'Show').replace('Episodes', 'Episode');
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

// Missing Episodes - Collapse State Management
function getMissingGroupCollapseState(showId) {
    try {
        const states = JSON.parse(localStorage.getItem('missingGroupCollapseStates') || '{}');
        return states[showId] === true;
    } catch {
        return false;
    }
}

function setMissingGroupCollapseState(showId, collapsed) {
    try {
        const states = JSON.parse(localStorage.getItem('missingGroupCollapseStates') || '{}');
        if (collapsed) {
            states[showId] = true;
        } else {
            delete states[showId];
        }
        localStorage.setItem('missingGroupCollapseStates', JSON.stringify(states));
    } catch {
        // Ignore localStorage errors
    }
}

function toggleMissingShowGroup(header, showId) {
    const wrapper = header.nextElementSibling;
    const chevron = header.querySelector('.missing-show-chevron');

    if (wrapper.classList.contains('open')) {
        wrapper.classList.remove('open');
        chevron.innerHTML = '&#9654;'; // Right arrow
        setMissingGroupCollapseState(showId, true);
    } else {
        wrapper.classList.add('open');
        chevron.innerHTML = '&#9660;'; // Down arrow
        setMissingGroupCollapseState(showId, false);
    }
}

function toggleAllMissingGroups(expand) {
    document.querySelectorAll('.missing-show-group').forEach(group => {
        const showId = group.dataset.showId;
        const wrapper = group.querySelector('.missing-episodes-table-wrapper');
        const chevron = group.querySelector('.missing-show-chevron');

        if (expand) {
            wrapper.classList.add('open');
            chevron.innerHTML = '&#9660;';
            setMissingGroupCollapseState(showId, false);
        } else {
            wrapper.classList.remove('open');
            chevron.innerHTML = '&#9654;';
            setMissingGroupCollapseState(showId, true);
        }
    });
}

function toggleAllMissingInShow(headerCheckbox, showId) {
    const checkboxes = document.querySelectorAll(`.episode-checkbox[data-show-id="${showId}"]`);
    checkboxes.forEach(cb => cb.checked = headerCheckbox.checked);
    updateMissingSelectionCount();
}

function updateMissingSelectionCount() {
    const selected = getSelectedMissingEpisodes();
    const countEl = document.getElementById('missing-selected-count');
    const fixMatchBtn = document.getElementById('btn-fix-match');
    const ignoreBtn = document.getElementById('btn-ignore');
    const specialsBtn = document.getElementById('btn-specials');

    if (countEl) {
        countEl.textContent = `${selected.length} selected`;
    }
    if (fixMatchBtn) {
        fixMatchBtn.disabled = selected.length === 0;
    }
    if (ignoreBtn) {
        ignoreBtn.disabled = selected.length === 0;
    }
    if (specialsBtn) {
        specialsBtn.disabled = selected.length === 0;
    }
}

function getSelectedMissingEpisodes() {
    const selected = [];
    document.querySelectorAll('.episode-checkbox:checked').forEach(cb => {
        selected.push({
            showId: parseInt(cb.dataset.showId),
            episodeId: parseInt(cb.dataset.episodeId),
            showName: cb.dataset.showName
        });
    });
    return selected;
}

// Scan Selected Episodes
async function scanSelectedEpisodes() {
    const selected = getSelectedMissingEpisodes();
    if (selected.length === 0) {
        showToast('No episodes selected', 'warning');
        return;
    }

    // Show scanning modal
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Scanning Episodes';
    modalBody.innerHTML = `
        <div class="scanning-progress">
            <div class="scanning-spinner"></div>
            <p class="scanning-status">Scanning ${selected.length} episode${selected.length > 1 ? 's' : ''}...</p>
            <p class="text-muted">Looking for matching files in show folders</p>
        </div>
    `;
    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');

    try {
        const result = await api('/scan/selected-episodes', {
            method: 'POST',
            body: JSON.stringify({
                episode_ids: selected.map(s => s.episodeId)
            })
        });

        // Show results
        const foundResults = result.results?.filter(r => r.status === 'found') || [];
        const notFoundResults = result.results?.filter(r => r.status !== 'found') || [];

        modalTitle.textContent = 'Scan Complete';
        modalBody.innerHTML = `
            <div class="scan-selected-results">
                <div class="scan-selected-summary">
                    <div class="scan-stat ${result.found > 0 ? 'scan-stat-success' : ''}">
                        <span class="scan-stat-value">${result.found}</span>
                        <span class="scan-stat-label">Found</span>
                    </div>
                    <div class="scan-stat ${result.not_found > 0 ? 'scan-stat-warning' : ''}">
                        <span class="scan-stat-value">${result.not_found}</span>
                        <span class="scan-stat-label">Not Found</span>
                    </div>
                </div>
                ${foundResults.length > 0 ? `
                    <div class="scan-results-section">
                        <h4 class="scan-results-header scan-results-success">Found (${foundResults.length})</h4>
                        <div class="scan-results-list">
                            ${foundResults.map(r => `
                                <div class="scan-result-item scan-result-found">
                                    <span class="scan-result-icon">✓</span>
                                    <span class="scan-result-text"><strong>${escapeHtml(r.show_name)}</strong> ${r.episode_code}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                ${notFoundResults.length > 0 ? `
                    <div class="scan-results-section">
                        <h4 class="scan-results-header scan-results-warning">Not Found (${notFoundResults.length})</h4>
                        <div class="scan-results-list">
                            ${notFoundResults.map(r => `
                                <div class="scan-result-item scan-result-notfound">
                                    <span class="scan-result-icon">✗</span>
                                    <span class="scan-result-text"><strong>${escapeHtml(r.show_name)}</strong> ${r.episode_code}</span>
                                    <span class="scan-result-message">${escapeHtml(r.message)}</span>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                ` : ''}
                <div class="scan-results-actions">
                    <button class="btn btn-primary" onclick="closeModal(); renderScan();">Done</button>
                </div>
            </div>
        `;
        document.querySelector('.modal-close').style.display = '';

    } catch (error) {
        document.querySelector('.modal-close').style.display = '';
        closeModal();
        // Error already shown by api()
    }
}

// Ignore Episodes
async function ignoreSelectedEpisodes() {
    const selected = getSelectedMissingEpisodes();
    if (selected.length === 0) {
        showToast('No episodes selected', 'warning');
        return;
    }

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Ignore Episodes';
    modalBody.innerHTML = `
        <p>Are you sure you want to ignore <strong>${selected.length}</strong> episode${selected.length > 1 ? 's' : ''}?</p>
        <p class="text-muted">Ignored episodes will not appear in the missing episodes list.</p>
        <div class="form-group" style="margin-top: 15px;">
            <label>Quick Select</label>
            <select class="form-control" onchange="if(this.value) document.getElementById('ignore-reason').value = this.value; this.value = '';">
                <option value="">Choose a reason...</option>
                <option value="Error on TMDB">Error on TMDB</option>
                <option value="Search for later">Search for later</option>
            </select>
        </div>
        <div class="form-group">
            <label>Reason (optional)</label>
            <input type="text" id="ignore-reason" class="form-control" placeholder="e.g., Not released in my region">
        </div>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-warning" onclick="confirmIgnoreEpisodes()">Ignore Episodes</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmIgnoreEpisodes() {
    const selected = getSelectedMissingEpisodes();
    const reason = document.getElementById('ignore-reason')?.value.trim() || null;

    closeModal();

    try {
        const result = await api('/scan/ignore-episodes', {
            method: 'POST',
            body: JSON.stringify({
                episode_ids: selected.map(s => s.episodeId),
                reason: reason
            })
        });

        showToast(result.message, 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

// Mark as Specials
async function markSelectedAsSpecials() {
    const selected = getSelectedMissingEpisodes();
    if (selected.length === 0) {
        showToast('No episodes selected', 'warning');
        return;
    }

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Mark as Specials';
    modalBody.innerHTML = `
        <p>Mark <strong>${selected.length}</strong> episode${selected.length > 1 ? 's' : ''} as specials?</p>
        <p class="text-muted">These episodes will be moved to a separate specials list for handling later.</p>
        <div class="form-group" style="margin-top: 15px;">
            <label>Quick Select</label>
            <select class="form-control" onchange="if(this.value) document.getElementById('specials-notes').value = this.value; this.value = '';">
                <option value="">Choose a reason...</option>
                <option value="Holiday Special">Holiday Special</option>
                <option value="Behind the scenes">Behind the scenes</option>
                <option value="Web Episode">Web Episode</option>
            </select>
        </div>
        <div class="form-group">
            <label>Notes (optional)</label>
            <input type="text" id="specials-notes" class="form-control" placeholder="e.g., Behind the scenes, Holiday special">
        </div>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="confirmMarkAsSpecials()">Mark as Specials</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmMarkAsSpecials() {
    const selected = getSelectedMissingEpisodes();
    const notes = document.getElementById('specials-notes')?.value.trim() || null;

    closeModal();

    try {
        const result = await api('/scan/special-episodes', {
            method: 'POST',
            body: JSON.stringify({
                episode_ids: selected.map(s => s.episodeId),
                notes: notes
            })
        });

        showToast(result.message, 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

// Fix Match Modal
let fixMatchSelectedShow = null;

function showFixMatchModal() {
    const selected = getSelectedMissingEpisodes();
    if (selected.length === 0) {
        showToast('No episodes selected', 'warning');
        return;
    }

    // Get unique show names from selection
    const showNames = [...new Set(selected.map(s => s.showName))];

    fixMatchSelectedShow = null;

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Fix Match';
    modalBody.innerHTML = `
        <div class="fix-match-modal">
            <div class="fix-match-selected-info">
                <strong>${selected.length}</strong> episode${selected.length > 1 ? 's' : ''} selected from: ${showNames.join(', ')}
            </div>
            <p>Search for the correct show to reassign these episodes:</p>
            <div class="fix-match-search">
                <input type="text" id="fix-match-search-input" class="form-control" placeholder="Search TMDB for correct show..." onkeydown="if(event.key==='Enter')searchForFixMatch()">
                <button class="btn btn-primary" onclick="searchForFixMatch()">Search</button>
            </div>
            <div class="fix-match-results" id="fix-match-results">
                <p class="text-muted" style="padding: 20px; text-align: center;">Search for a show above</p>
            </div>
            <div class="fix-match-actions">
                <button class="btn btn-primary" id="btn-confirm-fix-match" onclick="confirmFixMatch()" disabled>Reassign Episodes</button>
                <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            </div>
        </div>
    `;
    modal.classList.add('active');

    // Focus search input
    setTimeout(() => document.getElementById('fix-match-search-input')?.focus(), 100);
}

async function searchForFixMatch() {
    const query = document.getElementById('fix-match-search-input')?.value.trim();
    if (!query) return;

    const resultsDiv = document.getElementById('fix-match-results');
    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        // Search both local library and TMDB
        const [tmdbResults, localShows] = await Promise.all([
            api(`/shows/search/tmdb?q=${encodeURIComponent(query)}`),
            api('/shows')
        ]);

        // Filter local shows by name
        const queryLower = query.toLowerCase();
        const matchingLocalShows = localShows.filter(show =>
            show.name.toLowerCase().includes(queryLower)
        );

        let html = '';

        // Show local matches first
        if (matchingLocalShows.length > 0) {
            html += '<div style="padding: 8px 12px; background: var(--darker-bg); font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">In Your Library</div>';
            matchingLocalShows.forEach(show => {
                const year = show.first_air_date ? show.first_air_date.substring(0, 4) : '';
                html += `
                    <div class="fix-match-result" onclick="selectFixMatchShow(${show.id}, '${escapeHtml(show.name).replace(/'/g, "\\'")}', true)">
                        <img src="${show.poster_path ? TMDB_IMAGE_BASE + show.poster_path : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 60%22><rect fill=%22%23252542%22 width=%2240%22 height=%2260%22/></svg>'}" class="fix-match-poster">
                        <div class="fix-match-info">
                            <div class="fix-match-name">${escapeHtml(show.name)}</div>
                            <div class="fix-match-year">${year} - In Library</div>
                        </div>
                    </div>
                `;
            });
        }

        // Then TMDB results
        const tmdbShows = tmdbResults.results || [];
        if (tmdbShows.length > 0) {
            html += '<div style="padding: 8px 12px; background: var(--darker-bg); font-weight: 600; font-size: 0.85rem; color: var(--text-secondary);">Add from TMDB</div>';
            tmdbShows.slice(0, 10).forEach(show => {
                const inLibrary = localShows.some(ls => ls.tmdb_id === show.id);
                if (inLibrary) return; // Skip if already shown in local

                const year = show.first_air_date ? show.first_air_date.substring(0, 4) : '';
                html += `
                    <div class="fix-match-result" onclick="selectFixMatchShow(${show.id}, '${escapeHtml(show.name).replace(/'/g, "\\'")}', false)">
                        <img src="${show.poster_path ? TMDB_IMAGE_BASE + show.poster_path : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 60%22><rect fill=%22%23252542%22 width=%2240%22 height=%2260%22/></svg>'}" class="fix-match-poster">
                        <div class="fix-match-info">
                            <div class="fix-match-name">${escapeHtml(show.name)}</div>
                            <div class="fix-match-year">${year}</div>
                        </div>
                    </div>
                `;
            });
        }

        if (!html) {
            html = '<p class="text-muted" style="padding: 20px; text-align: center;">No shows found</p>';
        }

        resultsDiv.innerHTML = html;
    } catch (error) {
        resultsDiv.innerHTML = '<p class="text-muted" style="padding: 20px; text-align: center;">Search failed</p>';
    }
}

function selectFixMatchShow(showId, showName, isLocal) {
    // Clear previous selection
    document.querySelectorAll('.fix-match-result').forEach(el => el.classList.remove('selected'));

    // Mark new selection
    event.currentTarget.classList.add('selected');

    fixMatchSelectedShow = { id: showId, name: showName, isLocal };

    // Enable confirm button
    const confirmBtn = document.getElementById('btn-confirm-fix-match');
    if (confirmBtn) confirmBtn.disabled = false;
}

async function confirmFixMatch() {
    if (!fixMatchSelectedShow) {
        showToast('Please select a show', 'warning');
        return;
    }

    const selected = getSelectedMissingEpisodes();

    closeModal();

    try {
        let targetShowId = fixMatchSelectedShow.id;

        // If not in library, add the show first
        if (!fixMatchSelectedShow.isLocal) {
            showToast('Adding show to library...', 'info');
            const newShow = await api('/shows', {
                method: 'POST',
                body: JSON.stringify({ tmdb_id: fixMatchSelectedShow.id })
            });
            targetShowId = newShow.id;
        }

        // Now reassign the episodes
        const result = await api('/scan/fix-match', {
            method: 'POST',
            body: JSON.stringify({
                episode_ids: selected.map(s => s.episodeId),
                new_show_id: targetShowId
            })
        });

        showToast(result.message, 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}
