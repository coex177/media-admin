/**
 * Media Admin - Dashboard (rendering, card drag-drop, distribution toggles)
 */

// Dashboard view state (loaded from DB in checkSetup)
let currentShowsView = 'cards';

// Stat card order (loaded from DB in checkSetup)
const defaultStatCardOrder = [
    'total-shows', 'episodes-found', 'episodes-missing',
    'ignored', 'pending-actions', 'collection-progress',
    'total-movies', 'movies-found', 'movies-missing'
];
let statCardOrder = [...defaultStatCardOrder];
let hiddenCards = [];

// Dashboard card states (loaded from DB in checkSetup)
const defaultCardOrder = [
    'recently-aired', 'upcoming', 'recently-added', 'recently-ended',
    'most-incomplete', 'recently-matched', 'returning-soon',
    'last-scan', 'storage-stats', 'genre-distribution', 'network-distribution',
    'extra-files',
    'recently-added-movies', 'recently-matched-movies'
];
let dashboardCardOrder = [...defaultCardOrder];
let dashboardCardStates = {};

// Dashboard data cache for re-rendering after drag
let dashboardData = {};

// Keys in dashboardData that hold arrays (vs objects like lastScan, storageStats)
const _arrayDataKeys = new Set([
    'recentlyAired', 'recentlyAdded', 'upcoming', 'recentlyEnded',
    'mostIncomplete', 'recentlyMatched', 'returningSoon',
    'genreDistribution', 'networkDistribution', 'extraFiles',
    'recentlyAddedMovies', 'recentlyMatchedMovies'
]);

// Map dashboard card IDs to their API endpoint and dashboardData key
const cardDataEndpoints = {
    'recently-aired':       { key: 'recentlyAired',       endpoint: '/recently-aired' },
    'recently-added':       { key: 'recentlyAdded',       endpoint: '/recently-added' },
    'upcoming':             { key: 'upcoming',             endpoint: '/upcoming' },
    'recently-ended':       { key: 'recentlyEnded',       endpoint: '/recently-ended' },
    'most-incomplete':      { key: 'mostIncomplete',      endpoint: '/most-incomplete' },
    'recently-matched':     { key: 'recentlyMatched',     endpoint: '/recently-matched' },
    'returning-soon':       { key: 'returningSoon',       endpoint: '/returning-soon' },
    'last-scan':            { key: 'lastScan',            endpoint: '/last-scan' },
    'storage-stats':        { key: 'storageStats',        endpoint: '/storage-stats' },
    'genre-distribution':   { key: 'genreDistribution',   endpoint: '/genre-distribution' },
    'network-distribution': { key: 'networkDistribution', endpoint: '/network-distribution' },
    'extra-files':          { key: 'extraFiles',          endpoint: '/extra-files' },
    'recently-added-movies':    { key: 'recentlyAddedMovies',    endpoint: '/movies/recently-added' },
    'recently-matched-movies':  { key: 'recentlyMatchedMovies',  endpoint: '/movies/recently-matched' }
};

// Dashboard
async function renderDashboard() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        // Always load stats + settings (needed for stat cards and pending actions alert)
        const [stats, settings, movieStats] = await Promise.all([
            api('/stats'),
            api('/settings'),
            api('/movies/stats').catch(() => ({ total_movies: 0, movies_found: 0, movies_missing: 0 }))
        ]);

        state.stats = stats;
        state.settings = settings;
        dashboardData = { stats, settings };
        dashboardData.movieStats = movieStats;

        // Render immediately with stat cards; dashboard cards show loading state
        renderDashboardContent();

        // Then load data only for visible dashboard cards
        await loadVisibleCardData();
    } catch (error) {
        appContent.innerHTML = `
            <div class="alert alert-danger">
                Failed to load dashboard. Please check your connection and try again.
            </div>
        `;
    }
}

// Load data for all visible dashboard cards that don't have data yet
async function loadVisibleCardData() {
    const visibleCards = dashboardCardOrder.filter(id => !hiddenCards.includes(id));
    const toLoad = visibleCards.filter(id => {
        const info = cardDataEndpoints[id];
        return info && dashboardData[info.key] === undefined;
    });

    if (toLoad.length === 0) return;

    const fetches = toLoad.map(id => {
        const info = cardDataEndpoints[id];
        return api(info.endpoint)
            .then(data => { dashboardData[info.key] = data; })
            .catch(() => { dashboardData[info.key] = _arrayDataKeys.has(info.key) ? [] : {}; });
    });

    await Promise.all(fetches);
    renderDashboardContent();
}

// Load data for a single card if missing, then re-render
async function ensureCardData(cardId) {
    const info = cardDataEndpoints[cardId];
    if (!info || dashboardData[info.key] !== undefined) return;

    try {
        dashboardData[info.key] = await api(info.endpoint);
    } catch {
        dashboardData[info.key] = _arrayDataKeys.has(info.key) ? [] : {};
    }
    renderDashboardContent();
}

function renderDashboardContent() {
    const {
        stats, recentlyAired, recentlyAdded, upcoming, recentlyEnded,
        mostIncomplete, recentlyMatched, returningSoon, lastScan,
        storageStats, genreDistribution, networkDistribution, settings,
        extraFiles, movieStats,
        recentlyAddedMovies, recentlyMatchedMovies
    } = dashboardData;
    const upcomingDays = settings?.upcoming_days || 14;
    const recentlyAiredDays = settings?.recently_aired_days || 14;
    const displayEpFormat = settings?.display_episode_format || '{season}x{episode:02d}';

    // Calculate collection progress (ignored excluded from both numerator and denominator)
    const collectedEpisodes = stats?.found_episodes || 0;
    const totalAired = collectedEpisodes + (stats?.missing_episodes || 0);
    const collectionPercent = totalAired > 0 ? ((collectedEpisodes / totalAired) * 100).toFixed(1) : 0;

    // Loading placeholder for dashboard cards whose data hasn't arrived yet
    function _cardLoading(cardId, title) {
        return `
            <div class="card dashboard-card draggable-card" draggable="true" data-card-id="${cardId}"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <div class="card-header">
                    <h2 class="card-title">${title}</h2>
                    <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('${cardId}')">&times;</button>
                </div>
                <div class="dashboard-card-content open" style="display:flex;justify-content:center;padding:20px;">
                    <div class="spinner"></div>
                </div>
            </div>`;
    }

    // Stat card render functions
    const statCardRenderers = {
        'total-shows': () => `
            <div class="stat-card draggable-card" draggable="true" data-card-id="total-shows"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)"
                 onclick="navigateTo('shows')">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('total-shows')">&times;</button>
                <div class="stat-value">${stats.total_shows}</div>
                <div class="stat-label">Total Shows</div>
            </div>`,
        'episodes-found': () => `
            <div class="stat-card success draggable-card" draggable="true" data-card-id="episodes-found"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('episodes-found')">&times;</button>
                <div class="stat-value">${stats.found_episodes}</div>
                <div class="stat-label">Episodes Found</div>
            </div>`,
        'episodes-missing': () => `
            <div class="stat-card danger draggable-card" draggable="true" data-card-id="episodes-missing"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('episodes-missing')">&times;</button>
                <div class="stat-value">${stats.missing_episodes}</div>
                <div class="stat-label">Episodes Missing</div>
            </div>`,
        'ignored': () => `
            <div class="stat-card ignored draggable-card" draggable="true" data-card-id="ignored"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('ignored')">&times;</button>
                <div class="stat-value">${stats.ignored_episodes || 0}</div>
                <div class="stat-label">Ignored</div>
            </div>`,
        'pending-actions': () => `
            <div class="stat-card warning draggable-card" draggable="true" data-card-id="pending-actions"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)"
                 onclick="navigateTo('scan')">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('pending-actions')">&times;</button>
                <div class="stat-value">${stats.pending_actions}</div>
                <div class="stat-label">Pending Actions</div>
            </div>`,
        'collection-progress': () => `
            <div class="stat-card ${collectionPercent >= 90 ? 'success' : collectionPercent >= 70 ? 'warning' : 'danger'} draggable-card" draggable="true" data-card-id="collection-progress"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('collection-progress')">&times;</button>
                <div class="stat-value">${collectionPercent}%</div>
                <div class="stat-label">Collection Progress</div>
            </div>`,
        'total-movies': () => `
            <div class="stat-card draggable-card" draggable="true" data-card-id="total-movies"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)"
                 onclick="navigateTo('movies')">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('total-movies')">&times;</button>
                <div class="stat-value">${(movieStats && movieStats.total_movies) || 0}</div>
                <div class="stat-label">Total Movies</div>
            </div>`,
        'movies-found': () => `
            <div class="stat-card success draggable-card" draggable="true" data-card-id="movies-found"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('movies-found')">&times;</button>
                <div class="stat-value">${(movieStats && movieStats.movies_found) || 0}</div>
                <div class="stat-label">Movies Found</div>
            </div>`,
        'movies-missing': () => `
            <div class="stat-card danger draggable-card" draggable="true" data-card-id="movies-missing"
                 ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                 ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('movies-missing')">&times;</button>
                <div class="stat-value">${(movieStats && movieStats.movies_missing) || 0}</div>
                <div class="stat-label">Movies Missing</div>
            </div>`
    };

    // Card render functions
    const cardRenderers = {
        'recently-aired': () => {
            if (recentlyAired === undefined) return _cardLoading('recently-aired', 'Recently Aired');
            const isOpen = dashboardCardStates['recently-aired'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-aired"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-aired')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-aired" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Aired (${recentlyAiredDays} days)
                        </h2>
                        <span class="badge ${recentlyAired.filter(e => e.file_status === 'missing').length > 0 ? 'badge-danger' : 'badge-success'}">
                            ${recentlyAired.filter(e => e.file_status !== 'missing').length}/${recentlyAired.length} collected
                        </span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-aired')">&times;</button>
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
            if (recentlyAdded === undefined) return _cardLoading('recently-added', 'Recently Added Shows');
            const isOpen = dashboardCardStates['recently-added'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-added"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-added')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-added" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Added Shows
                        </h2>
                        <span class="text-muted">${recentlyAdded.length} shows</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-added')">&times;</button>
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
                                        ? `${getImageUrl(show.poster_path)}`
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
            if (upcoming === undefined) return _cardLoading('upcoming', 'Upcoming');
            const isOpen = dashboardCardStates['upcoming'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="upcoming"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('upcoming')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-upcoming" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Upcoming (${upcomingDays} days)
                        </h2>
                        <span class="text-muted">${upcoming.length} episodes</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('upcoming')">&times;</button>
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
            if (recentlyEnded === undefined) return _cardLoading('recently-ended', 'Recently Ended');
            const isOpen = dashboardCardStates['recently-ended'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-ended"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-ended')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-ended" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Ended
                        </h2>
                        <span class="text-muted">${recentlyEnded.length} shows</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-ended')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-ended">
                        ${recentlyEnded.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No recently ended shows</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${recentlyEnded.map(show => {
                                    const posterUrl = show.poster_path
                                        ? `${getImageUrl(show.poster_path)}`
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
            if (mostIncomplete === undefined) return _cardLoading('most-incomplete', 'Most Incomplete');
            const isOpen = dashboardCardStates['most-incomplete'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="most-incomplete"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('most-incomplete')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-most-incomplete" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Most Incomplete
                        </h2>
                        <span class="text-muted">${mostIncomplete.length} shows</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('most-incomplete')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-most-incomplete">
                        ${mostIncomplete.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">All shows are complete!</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${mostIncomplete.map(show => {
                                    const posterUrl = show.poster_path ? `${getImageUrl(show.poster_path)}` : null;
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
            if (recentlyMatched === undefined) return _cardLoading('recently-matched', 'Recently Matched');
            const isOpen = dashboardCardStates['recently-matched'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-matched"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-matched')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-matched" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Matched
                        </h2>
                        <span class="text-muted">${recentlyMatched.length} episodes</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-matched')">&times;</button>
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
            if (returningSoon === undefined) return _cardLoading('returning-soon', 'Returning Soon');
            const isOpen = dashboardCardStates['returning-soon'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="returning-soon"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('returning-soon')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-returning-soon" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Returning Soon
                        </h2>
                        <span class="text-muted">${returningSoon.length} shows</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('returning-soon')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-returning-soon">
                        ${returningSoon.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No shows returning soon</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${returningSoon.map(show => {
                                    const posterUrl = show.poster_path ? `${getImageUrl(show.poster_path)}` : null;
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
            if (lastScan === undefined) return _cardLoading('last-scan', 'Last Scan');
            const isOpen = dashboardCardStates['last-scan'];
            const scanTime = lastScan.last_scan_time ? new Date(lastScan.last_scan_time).toLocaleString() : 'Never';
            const result = lastScan.result || {};
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="last-scan"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('last-scan')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-last-scan" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Last Scan
                        </h2>
                        <span class="text-muted">${scanTime}</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('last-scan')">&times;</button>
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
            if (storageStats === undefined) return _cardLoading('storage-stats', 'Storage Stats');
            const isOpen = dashboardCardStates['storage-stats'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="storage-stats"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('storage-stats')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-storage-stats" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Storage Stats
                        </h2>
                        <span class="text-muted">${storageStats.total_size_gb} GB</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('storage-stats')">&times;</button>
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
            if (genreDistribution === undefined) return _cardLoading('genre-distribution', 'Genres');
            const isOpen = dashboardCardStates['genre-distribution'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="genre-distribution"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('genre-distribution')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-genre-distribution" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Genres
                        </h2>
                        <span class="text-muted">${genreDistribution.length} genres</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('genre-distribution')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-genre-distribution">
                        ${genreDistribution.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No genre data available. Refresh shows to fetch genres.</p>
                        ` : `
                            <div class="distribution-list distribution-scrollable">
                                ${genreDistribution.map(g => `
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
            if (networkDistribution === undefined) return _cardLoading('network-distribution', 'Networks');
            const isOpen = dashboardCardStates['network-distribution'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="network-distribution"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('network-distribution')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-network-distribution" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Networks
                        </h2>
                        <span class="text-muted">${networkDistribution.length} networks</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('network-distribution')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-network-distribution">
                        ${networkDistribution.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No network data available. Refresh shows to fetch networks.</p>
                        ` : `
                            <div class="distribution-list distribution-scrollable">
                                ${networkDistribution.map(n => `
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
        },
        'extra-files': () => {
            if (extraFiles === undefined) return _cardLoading('extra-files', 'Extra Files on Disk');
            const isOpen = dashboardCardStates['extra-files'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="extra-files"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('extra-files')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-extra-files" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Extra Files on Disk
                        </h2>
                        <span class="badge ${extraFiles.length > 0 ? 'badge-warning' : 'badge-success'}">${extraFiles.length} show${extraFiles.length !== 1 ? 's' : ''}</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('extra-files')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-extra-files">
                        ${extraFiles.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No extra files detected</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${extraFiles.map(show => {
                                    const posterUrl = show.poster_path ? `${getImageUrl(show.poster_path)}` : null;
                                    return `
                                        <div class="recent-show-item" onclick="showShowDetail(${show.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl ? `<img src="${posterUrl}" alt="${escapeHtml(show.name)}">` : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(show.name)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${show.matched_episodes} matched</span>
                                                    <span class="text-muted">|</span>
                                                    <span>${show.disk_files} files</span>
                                                </div>
                                                <div class="recent-show-status">
                                                    <span class="badge badge-warning badge-sm">${show.extra} extra</span>
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
        'recently-added-movies': () => {
            if (recentlyAddedMovies === undefined) return _cardLoading('recently-added-movies', 'Recently Added Movies');
            const isOpen = dashboardCardStates['recently-added-movies'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-added-movies"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-added-movies')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-added-movies" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Added Movies
                        </h2>
                        <span class="text-muted">${recentlyAddedMovies.length} movies</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-added-movies')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-added-movies">
                        ${recentlyAddedMovies.length === 0 ? `
                            <div class="empty-state-sm">
                                <p class="text-muted">No movies added yet</p>
                                <button class="btn btn-sm btn-primary" onclick="showAddMovieModal()">+ Add Movie</button>
                            </div>
                        ` : `
                            <div class="recent-shows-list">
                                ${recentlyAddedMovies.map(movie => {
                                    const posterUrl = movie.poster_path ? getImageUrl(movie.poster_path) : null;
                                    return `
                                        <div class="recent-show-item" onclick="showMovieDetail(${movie.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl
                                                    ? `<img src="${posterUrl}" alt="${escapeHtml(movie.title)}">`
                                                    : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(movie.title)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${movie.year || 'Unknown'}</span>
                                                    ${movie.runtime ? `<span class="text-muted">|</span><span>${movie.runtime} min</span>` : ''}
                                                </div>
                                                <div class="recent-show-status">
                                                    ${movie.file_status === 'found' || movie.file_status === 'renamed'
                                                        ? `<span class="badge badge-success badge-sm">Found</span>`
                                                        : `<span class="badge badge-danger badge-sm">Missing</span>`}
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
        'recently-matched-movies': () => {
            if (recentlyMatchedMovies === undefined) return _cardLoading('recently-matched-movies', 'Recently Matched Movies');
            const isOpen = dashboardCardStates['recently-matched-movies'];
            return `
                <div class="card dashboard-card draggable-card" draggable="true" data-card-id="recently-matched-movies"
                     ondragstart="handleUnifiedDragStart(event)" ondragover="handleUnifiedDragOver(event)"
                     ondragleave="handleUnifiedDragLeave(event)" ondrop="handleUnifiedDrop(event)" ondragend="handleUnifiedDragEnd(event)">
                    <div class="card-header clickable" onclick="toggleDashboardCard('recently-matched-movies')">
                        <h2 class="card-title">
                            <img class="dashboard-card-chevron" id="chevron-recently-matched-movies" src="/static/images/${isOpen ? 'show-collapse' : 'show-expand'}.png" alt="">
                            Recently Matched Movies
                        </h2>
                        <span class="text-muted">${recentlyMatchedMovies.length} movies</span>
                        <button class="card-close-btn" onclick="event.stopPropagation(); hideCard('recently-matched-movies')">&times;</button>
                    </div>
                    <div class="dashboard-card-content ${isOpen ? 'open' : ''}" id="content-recently-matched-movies">
                        ${recentlyMatchedMovies.length === 0 ? `
                            <p class="text-muted text-center" style="padding: 20px;">No recently matched movies</p>
                        ` : `
                            <div class="recent-shows-list">
                                ${recentlyMatchedMovies.map(movie => {
                                    const posterUrl = movie.poster_path ? getImageUrl(movie.poster_path) : null;
                                    const matchedDate = movie.matched_at ? new Date(movie.matched_at).toLocaleDateString() : 'Unknown';
                                    return `
                                        <div class="recent-show-item" onclick="showMovieDetail(${movie.id})">
                                            <div class="recent-show-poster">
                                                ${posterUrl
                                                    ? `<img src="${posterUrl}" alt="${escapeHtml(movie.title)}">`
                                                    : `<div class="poster-placeholder"></div>`}
                                            </div>
                                            <div class="recent-show-info">
                                                <div class="recent-show-name">${escapeHtml(movie.title)}</div>
                                                <div class="recent-show-meta">
                                                    <span>${movie.year || 'Unknown'}</span>
                                                    <span class="text-muted">|</span>
                                                    <span>Matched ${matchedDate}</span>
                                                </div>
                                                <div class="recent-show-status">
                                                    <span class="badge badge-success badge-sm">Matched</span>
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
        }
    };

    appContent.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Dashboard</h1>
            <div class="dashboard-layout-controls">
                <span class="dashboard-layout-label">Dashboard Layout</span>
                <div class="card-control-btns">
                    <button class="card-control-btn" onclick="collapseAllCards()" title="Collapse all"><img src="/static/images/collapse.png" alt="Collapse"></button>
                    <button class="card-control-btn" onclick="expandAllCards()" title="Expand all"><img src="/static/images/expand.png" alt="Expand"></button>
                    <button class="card-control-btn" onclick="showRestoreCardsModal()" title="Restore hidden cards"><img src="/static/images/restore.png" alt="Restore Cards"></button>
                    <button class="card-control-btn" onclick="resetDashboardLayout()" title="Reset layout to defaults"><img src="/static/images/reset-layout.png" alt="Reset Layout"></button>
                </div>
            </div>
        </div>

        <div class="stats-grid" id="stat-cards-container">
            ${statCardOrder.filter(id => !hiddenCards.includes(id))
                .map(id => statCardRenderers[id]?.() || '').join('')}
        </div>

        ${stats.pending_actions > 0 ? `
            <div class="alert alert-info">
                You have ${stats.pending_actions} pending actions.
                <a href="#" onclick="navigateTo('scan'); return false;" style="color: inherit; font-weight: bold;">Review them</a>
            </div>
        ` : ''}

        <div class="dashboard-grid" id="dashboard-cards-container">
            ${dashboardCardOrder.filter(id => !hiddenCards.includes(id))
                .map(cardId => cardRenderers[cardId] ? cardRenderers[cardId]() : '').join('')}
        </div>

    `;

    restorePendingScroll();
}

function toggleDistributionShows(type, name) {
    const el = document.getElementById(`distribution-${type}-${name}`);
    if (!el) return;
    const isVisible = el.style.display !== 'none';
    el.style.display = isVisible ? 'none' : 'block';

    const stored = getUiPref('expandedDistributions', {});
    if (!stored[type]) stored[type] = [];
    if (isVisible) {
        stored[type] = stored[type].filter(n => n !== name);
    } else {
        if (!stored[type].includes(name)) stored[type].push(name);
    }
    setUiPref('expandedDistributions', stored);
}

function isDistributionExpanded(type, name) {
    const stored = getUiPref('expandedDistributions', {});
    return (stored[type] || []).includes(name);
}

function toggleDashboardCard(cardId) {
    const content = document.getElementById(`content-${cardId}`);
    const chevron = document.getElementById(`chevron-${cardId}`);

    if (!content) return;

    const isOpen = content.classList.toggle('open');
    if (chevron) {
        chevron.src = isOpen ? '/static/images/show-collapse.png' : '/static/images/show-expand.png';
    }

    // Update in-memory state
    dashboardCardStates[cardId] = isOpen;

    // Only persist when the layout is mixed (not all same)
    if (_isCardStateMixed()) {
        setUiPref('dashboardCardStates', dashboardCardStates);
    }
}

function _applyCardStates(stateMap) {
    dashboardCardOrder.forEach(cardId => {
        const content = document.getElementById(`content-${cardId}`);
        const chevron = document.getElementById(`chevron-${cardId}`);
        const isOpen = !!stateMap[cardId];

        if (content) {
            content.classList.toggle('open', isOpen);
        }
        if (chevron) {
            chevron.src = isOpen ? '/static/images/show-collapse.png' : '/static/images/show-expand.png';
        }
    });
}

function _isCardStateMixed() {
    const states = dashboardCardOrder.map(id => !!dashboardCardStates[id]);
    return !states.every(s => s === states[0]);
}

function expandAllCards() {
    // Only changes display — never saves to localStorage
    dashboardCardOrder.forEach(cardId => {
        dashboardCardStates[cardId] = true;
    });
    _applyCardStates(dashboardCardStates);
}

function collapseAllCards() {
    // Only changes display — never saves to localStorage
    dashboardCardOrder.forEach(cardId => {
        dashboardCardStates[cardId] = false;
    });
    _applyCardStates(dashboardCardStates);
}

// Unified drag and drop handlers for stat + dashboard cards
let draggedCardId = null;
let draggedGridType = null;

function _getGridType(el) {
    if (el.closest('.stats-grid')) return 'stat';
    if (el.closest('.dashboard-grid')) return 'dashboard';
    return null;
}

function handleUnifiedDragStart(event) {
    const card = event.target.closest('.draggable-card');
    if (!card) return;
    draggedCardId = card.dataset.cardId;
    draggedGridType = _getGridType(card);
    card.classList.add('dragging');
    event.dataTransfer.effectAllowed = 'move';
}

function handleUnifiedDragOver(event) {
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';

    const card = event.target.closest('.draggable-card');
    if (card && card.dataset.cardId !== draggedCardId) {
        // Only show drag-over if same grid type
        const targetGrid = _getGridType(card);
        if (targetGrid === draggedGridType) {
            document.querySelectorAll('.draggable-card.drag-over').forEach(c => {
                if (c !== card) c.classList.remove('drag-over');
            });
            card.classList.add('drag-over');
        }
    }
}

function handleUnifiedDragLeave(event) {
    const card = event.target.closest('.draggable-card');
    if (card) {
        card.classList.remove('drag-over');
    }
}

function handleUnifiedDrop(event) {
    event.preventDefault();

    const targetCard = event.target.closest('.draggable-card');
    if (!targetCard || !draggedCardId) return;

    const targetCardId = targetCard.dataset.cardId;
    if (targetCardId === draggedCardId) return;

    const targetGrid = _getGridType(targetCard);
    // Cross-grid drops are ignored
    if (targetGrid !== draggedGridType) return;

    const order = targetGrid === 'stat' ? statCardOrder : dashboardCardOrder;
    const draggedIdx = order.indexOf(draggedCardId);
    const targetIdx = order.indexOf(targetCardId);

    if (draggedIdx !== -1 && targetIdx !== -1) {
        // Swap positions
        [order[draggedIdx], order[targetIdx]] = [order[targetIdx], order[draggedIdx]];

        setUiPref(targetGrid === 'stat' ? 'statCardOrder' : 'dashboardCardOrder', order);
        renderDashboardContent();
        animateSwap(draggedCardId, targetCardId);
    }

    targetCard.classList.remove('drag-over');
}

function handleUnifiedDragEnd(event) {
    draggedCardId = null;
    draggedGridType = null;
    document.querySelectorAll('.draggable-card').forEach(card => {
        card.classList.remove('dragging', 'drag-over');
    });
}

function animateSwap(id1, id2) {
    requestAnimationFrame(() => {
        const card1 = document.querySelector(`[data-card-id="${id1}"]`);
        const card2 = document.querySelector(`[data-card-id="${id2}"]`);
        if (card1) card1.classList.add('card-swap-flash');
        if (card2) card2.classList.add('card-swap-flash');
        setTimeout(() => {
            if (card1) card1.classList.remove('card-swap-flash');
            if (card2) card2.classList.remove('card-swap-flash');
        }, 500);
    });
}

// Card hide/restore
function hideCard(cardId) {
    if (!hiddenCards.includes(cardId)) {
        hiddenCards.push(cardId);
        setUiPref('hiddenCards', hiddenCards);
        renderDashboardContent();
    }
}

const cardNameMap = {
    'total-shows': 'Total Shows',
    'episodes-found': 'Episodes Found',
    'episodes-missing': 'Episodes Missing',
    'ignored': 'Ignored',
    'pending-actions': 'Pending Actions',
    'collection-progress': 'Collection Progress',
    'recently-aired': 'Recently Aired',
    'recently-added': 'Recently Added',
    'upcoming': 'Upcoming',
    'recently-ended': 'Recently Ended',
    'most-incomplete': 'Most Incomplete',
    'recently-matched': 'Recently Matched',
    'returning-soon': 'Returning Soon',
    'last-scan': 'Last Scan',
    'storage-stats': 'Storage Stats',
    'genre-distribution': 'Genres',
    'network-distribution': 'Networks',
    'extra-files': 'Extra Files',
    'total-movies': 'Total Movies',
    'movies-found': 'Movies Found',
    'movies-missing': 'Movies Missing',
    'recently-added-movies': 'Recently Added Movies',
    'recently-matched-movies': 'Recently Matched Movies'
};

function showRestoreCardsModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Restore Hidden Cards';

    if (hiddenCards.length === 0) {
        modalBody.innerHTML = `
            <p class="text-muted text-center" style="padding: 20px;">No hidden cards to restore.</p>
            <div class="modal-buttons">
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>`;
    } else {
        modalBody.innerHTML = `
            <div class="restore-cards-list">
                ${hiddenCards.map(id => `
                    <div class="restore-card-item">
                        <span>${cardNameMap[id] || id}</span>
                        <button class="btn btn-sm btn-primary" onclick="restoreCard('${id}')">Restore</button>
                    </div>
                `).join('')}
            </div>
            <div class="modal-buttons" style="margin-top: 15px;">
                <button class="btn btn-primary" onclick="restoreAllCards()">Restore All</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>`;
    }

    modal.classList.add('active');
}

function restoreCard(cardId) {
    hiddenCards = hiddenCards.filter(id => id !== cardId);
    // Ensure card is in its order array
    if (defaultStatCardOrder.includes(cardId) && !statCardOrder.includes(cardId)) {
        statCardOrder.push(cardId);
        setUiPref('statCardOrder', statCardOrder);
    }
    if (defaultCardOrder.includes(cardId) && !dashboardCardOrder.includes(cardId)) {
        dashboardCardOrder.push(cardId);
        setUiPref('dashboardCardOrder', dashboardCardOrder);
    }
    setUiPref('hiddenCards', hiddenCards);
    renderDashboardContent();
    // Load data for the restored card if needed
    ensureCardData(cardId);
    // Update the modal
    showRestoreCardsModal();
}

function restoreAllCards() {
    hiddenCards = [];
    setUiPref('hiddenCards', hiddenCards);
    renderDashboardContent();
    // Load data for any cards that were hidden and never fetched
    loadVisibleCardData();
    closeModal();
}

function resetDashboardLayout() {
    statCardOrder = [...defaultStatCardOrder];
    dashboardCardOrder = [...defaultCardOrder];
    hiddenCards = [];
    dashboardCardStates = {};
    setUiPref('statCardOrder', statCardOrder);
    setUiPref('dashboardCardOrder', dashboardCardOrder);
    setUiPref('hiddenCards', hiddenCards);
    setUiPref('dashboardCardStates', dashboardCardStates);
    renderDashboardContent();
    // Load data for any cards that were hidden and never fetched
    loadVisibleCardData();
}
