/**
 * Media Admin - Dashboard (rendering, card drag-drop, distribution toggles)
 */

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

// Snapshot of card states before bulk expand/collapse (for restore)
let _cardStateSnapshot = null;

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
            <div class="card-control-btns">
                <button class="card-control-btn" onclick="collapseAllCards()" title="Collapse all">&#9650;</button>
                <button class="card-control-btn" onclick="expandAllCards()" title="Expand all">&#9660;</button>
                <button class="card-control-btn" onclick="restoreSavedCards()" title="Restore saved layout">&#8617;</button>
                <button class="card-control-btn" onclick="clearSavedCards()" title="Reset to default (all collapsed)">&#10227;</button>
            </div>
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
            chevron.innerHTML = isOpen ? '&#9660;' : '&#9658;';
        }
    });
}

function expandAllCards() {
    // Snapshot current saved state before bulk change
    _cardStateSnapshot = { ...dashboardCardStates };

    dashboardCardOrder.forEach(cardId => {
        dashboardCardStates[cardId] = true;
    });
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));
    _applyCardStates(dashboardCardStates);
}

function collapseAllCards() {
    // Snapshot current saved state before bulk change
    _cardStateSnapshot = { ...dashboardCardStates };

    dashboardCardOrder.forEach(cardId => {
        dashboardCardStates[cardId] = false;
    });
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));
    _applyCardStates(dashboardCardStates);
}

function restoreSavedCards() {
    if (_cardStateSnapshot) {
        dashboardCardStates = { ..._cardStateSnapshot };
    }
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));
    _applyCardStates(dashboardCardStates);
}

function clearSavedCards() {
    _cardStateSnapshot = null;
    dashboardCardStates = {};
    localStorage.setItem('dashboardCardStates', JSON.stringify(dashboardCardStates));
    _applyCardStates(dashboardCardStates);
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
