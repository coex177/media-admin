/**
 * Media Admin - Shows (list/detail, add/edit modals, pagination, metadata refresh)
 */

function setShowsView(view) {
    currentShowsView = view;
    setUiPref('showsViewMode', view);

    // Update button states
    document.querySelectorAll('.view-btn').forEach(btn => btn.classList.remove('active'));
    document.querySelector(`.view-btn[onclick="setShowsView('${view}')"]`)?.classList.add('active');

    // Toggle list controls enabled/disabled
    const listControls = document.getElementById('shows-list-controls');
    if (listControls) {
        listControls.querySelectorAll('.card-control-btn').forEach(btn => {
            btn.disabled = (view !== 'list');
        });
    }

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
        ? `${getImageUrl(show.poster_path)}`
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

function getShowListExpandDefault() {
    const v = getUiPref('showsListExpandDefault', false);
    return v === true || v === 'true';
}

function getShowListExpandOverrides() {
    return getUiPref('showsListExpandOverrides', {});
}

function isShowListItemExpanded(showId) {
    const overrides = getShowListExpandOverrides();
    if (showId in overrides) return overrides[showId];
    return getShowListExpandDefault();
}

function setShowListExpandState(showId, expanded) {
    const overrides = getShowListExpandOverrides();
    const defaultState = getShowListExpandDefault();
    if (expanded === defaultState) {
        delete overrides[showId];
    } else {
        overrides[showId] = expanded;
    }
    setUiPref('showsListExpandOverrides', overrides);
}

function renderShowListItem(show) {
    const totalAired = show.episodes_found + show.episodes_missing;
    const isExpanded = isShowListItemExpanded(show.id);

    return `
        <div class="show-list-item" id="show-list-item-${show.id}">
            <div class="show-list-header" onclick="toggleShowListItem(${show.id})">
                <img src="${isExpanded ? '/static/images/show-collapse.png' : '/static/images/show-expand.png'}" class="show-list-chevron-img" id="show-list-chevron-${show.id}" alt="">
                <span class="show-list-name">${escapeHtml(show.name)}</span>
                <span class="show-list-status">
                    <span class="text-muted">${show.episodes_found}/${totalAired}</span>
                    ${show.episodes_missing > 0
                        ? `<span class="badge badge-danger badge-sm">${show.episodes_missing} missing</span>`
                        : `<span class="badge badge-success badge-sm">Complete</span>`}
                </span>
            </div>
            <div class="show-list-details ${isExpanded ? 'open' : ''}" id="show-list-details-${show.id}">
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
        chevron.src = isOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    }

    // Persist state
    setShowListExpandState(showId, !isOpen);
}

function collapseAllShowListItems() {
    // Set default to collapsed, clear all overrides
    setUiPref('showsListExpandDefault', false);
    setUiPref('showsListExpandOverrides', {});
    document.querySelectorAll('.show-list-item').forEach(item => {
        const showId = item.id.replace('show-list-item-', '');
        const details = document.getElementById(`show-list-details-${showId}`);
        const chevron = document.getElementById(`show-list-chevron-${showId}`);
        if (details) details.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
    });
}

function expandAllShowListItems() {
    // Set default to expanded, clear all overrides
    setUiPref('showsListExpandDefault', true);
    setUiPref('showsListExpandOverrides', {});
    document.querySelectorAll('.show-list-item').forEach(item => {
        const showId = item.id.replace('show-list-item-', '');
        const details = document.getElementById(`show-list-details-${showId}`);
        const chevron = document.getElementById(`show-list-chevron-${showId}`);
        if (details) details.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
    });
}


function renderShowCard(show) {
    const posterUrl = show.poster_path
        ? getImageUrl(show.poster_path)
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
        // Load settings to get shows_per_page if not already loaded
        if (!state.settings) {
            state.settings = await api('/settings');
        }
        state.showsPerPage = state.settings.shows_per_page ?? 0;

        const resp = await api(`/shows?page=${state.showsPage}&per_page=${state.showsPerPage}`);
        const shows = resp.shows;
        state.shows = shows;
        state.totalShows = resp.total;
        state.pageLabels = resp.page_labels || [];
        state.totalPages = resp.total_pages || 1;

        const totalPages = state.totalPages;
        // Clamp current page
        if (state.showsPage > totalPages && totalPages > 0) {
            state.showsPage = totalPages;
            return renderShowsList();
        }

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
                    <div class="card-control-btns" id="shows-list-controls">
                        <button class="card-control-btn" onclick="collapseAllShowListItems()" title="Collapse all" ${currentShowsView !== 'list' ? 'disabled' : ''}><img src="/static/images/collapse.png" alt="Collapse"></button>
                        <button class="card-control-btn" onclick="expandAllShowListItems()" title="Expand all" ${currentShowsView !== 'list' ? 'disabled' : ''}><img src="/static/images/expand.png" alt="Expand"></button>
                    </div>
                    <button class="btn btn-secondary" onclick="refreshAllMetadata()" id="refresh-all-btn">Refresh All Metadata</button>
                    <button class="btn btn-secondary" onclick="startSlowImport()">Managed Import</button>
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

            ${renderPagination(state.showsPage, totalPages, state.pageLabels)}

            <div class="card">
                <div id="shows-container">
                    ${renderShowsView(shows)}
                </div>
            </div>

            ${renderPagination(state.showsPage, totalPages, state.pageLabels)}
        `;

        // Check if refresh is in progress on page load
        checkRefreshStatus();
        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load shows.</div>`;
    }
}

function renderShowsPerPageSelect() {
    const val = state.showsPerPage || 0;
    const opts = (state.settings?.shows_per_page_options || [100,300,500,1000,1500])
        .map(v => [v, String(v)]);
    opts.push([0, 'All']);
    return `<select class="shows-per-page-select" onchange="changeShowsPerPage(this.value)">
        ${opts.map(([v,l]) =>
            `<option value="${v}" ${val === v ? 'selected' : ''}>${l}</option>`
        ).join('')}
    </select>`;
}

function renderPagination(currentPage, totalPages, pageLabels) {
    const perPageSelect = renderShowsPerPageSelect();

    if (totalPages <= 1) {
        return `<div class="pagination">${perPageSelect}</div>`;
    }

    let pageButtons = '';
    for (let i = 1; i <= totalPages; i++) {
        const label = pageLabels && pageLabels[i - 1] ? pageLabels[i - 1] : i;
        pageButtons += `<button class="pagination-btn ${i === currentPage ? 'active' : ''}" onclick="goToShowsPage(${i})">${label}</button>`;
    }

    return `
        <div class="pagination">
            <button class="pagination-btn" onclick="goToShowsPage(${currentPage - 1})" ${currentPage === 1 ? 'disabled' : ''}>Previous</button>
            ${pageButtons}
            <button class="pagination-btn" onclick="goToShowsPage(${currentPage + 1})" ${currentPage === totalPages ? 'disabled' : ''}>Next</button>
            ${perPageSelect}
        </div>
    `;
}

async function changeShowsPerPage(value) {
    const newVal = parseInt(value);
    state.showsPerPage = newVal;
    state.showsPage = 1;

    // Save to backend
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ shows_per_page: newVal })
        });
        if (state.settings) state.settings.shows_per_page = newVal;
    } catch (error) {
        // Continue with re-render even if save fails
    }

    renderShowsList();
}

function goToShowsPage(page) {
    const totalPages = state.totalPages || 1;
    if (page < 1 || page > totalPages) return;
    state.showsPage = page;
    window.scrollTo(0, 0);
    renderShowsList();
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
                const resp = await api(`/shows?page=${state.showsPage}&per_page=${state.showsPerPage}`);
                state.shows = resp.shows;
                state.totalShows = resp.total;
                state.totalPages = resp.total_pages || 1;
                state.pageLabels = resp.page_labels || [];
                const showsContainer = document.getElementById('shows-container');
                if (showsContainer) {
                    showsContainer.innerHTML = renderShowsView(resp.shows);
                }
            }
        }
    } catch (error) {
        // Silently fail status checks
    }
}

// Show Detail
async function showShowDetail(showId, targetSeason = null, targetEpisode = null, skipHistoryPush = false) {
    // Push current view to history before switching
    if (!skipHistoryPush) {
        pushCurrentViewToHistory();
    }

    // Update current view to show
    state.currentView = { type: 'show', page: state.currentPage, showId: showId, scrollY: 0 };

    // Hide episode preview (will show again when an episode is selected)
    const episodePreview = document.getElementById('episode-preview');
    if (episodePreview) episodePreview.style.display = 'none';

    // Clear active nav highlight
    document.querySelectorAll('.nav-menu a').forEach(a => a.classList.remove('active'));

    updateBackButtonVisibility();

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

        const posterUrl = show.poster_path ? getImageUrl(show.poster_path) : '';

        const today = new Date().toISOString().split('T')[0];

        const metadataSourceTag = show.metadata_source === 'tvdb'
            ? `<a href="https://thetvdb.com/dereferrer/series/${show.tvdb_id}" target="_blank" class="metadata-source-tag metadata-source-tvdb">TVDB</a>`
            : `<a href="https://www.themoviedb.org/tv/${show.tmdb_id}" target="_blank" class="metadata-source-tag metadata-source-tmdb">TMDB</a>`;

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">${escapeHtml(show.name)}${metadataSourceTag}</h1>
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
                            <img src="/static/images/show-expand.png" class="season-chevron-img" id="season-chevron-${seasonNum}" alt="">
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

            ${show.extra_files && show.extra_files.length > 0 ? (() => {
                const sortedExtra = [...show.extra_files].sort((a, b) => a.filename.localeCompare(b.filename, undefined, { numeric: true }));
                return `
                <div class="card season-card">
                    <div class="season-header-toggle" id="season-header-extra">
                        <div style="display: flex; align-items: center; gap: 10px; cursor: pointer;" onclick="toggleSeason('extra')">
                            <img src="/static/images/show-expand.png" class="season-chevron-img" id="season-chevron-extra" alt="">
                            <h3>Extra Files</h3>
                            <span class="badge badge-warning">${sortedExtra.length} file${sortedExtra.length !== 1 ? 's' : ''}</span>
                        </div>
                        <button class="btn btn-sm btn-secondary" id="fix-match-btn" disabled onclick="event.stopPropagation(); _fixMatchStep1_SearchShow(${show.id})">Fix Match</button>
                    </div>
                    <div class="episodes-list collapsed" id="season-extra-episodes">
                        <div class="episode-row">
                            <div class="episode-header not-aired" style="opacity:0.7;cursor:pointer;" onclick="var cb=document.getElementById('extra-file-select-all');cb.checked=!cb.checked;toggleAllExtraFiles(cb.checked);">
                                <input type="checkbox" id="extra-file-select-all" onchange="toggleAllExtraFiles(this.checked)" onclick="event.stopPropagation()" style="margin-right:8px;">
                                <span class="episode-title" style="font-style:italic;">Select All</span>
                            </div>
                        </div>
                        ${sortedExtra.map((file, i) => `
                            <div class="episode-row">
                                <div class="episode-header not-aired" style="cursor:pointer;" onclick="toggleExtraFileCheckbox(this)">
                                    <input type="checkbox" class="extra-file-checkbox" data-path="${escapeHtml(file.path)}" data-filename="${escapeHtml(file.filename)}" onchange="updateFixMatchButton()" onclick="event.stopPropagation()" style="margin-right:8px;">
                                    <span class="episode-number">${i + 1}</span>
                                    <span class="episode-title">${escapeHtml(file.filename)}</span>
                                    <span class="episode-status-badge missing">Unmatched</span>
                                </div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            `})() : ''}
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
        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load show details.</div>`;
    }
}

async function refreshShow(showId) {
    try {
        await api(`/shows/${showId}/refresh`, { method: 'POST' });
        showToast('Show metadata refreshed', 'success');
        showShowDetail(showId, null, null, true);
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
        // Remove deleted show's entries from the history stack
        state.navHistory = state.navHistory.filter(e => !(e.type === 'show' && e.showId === showId));
        navigateTo('shows', false, false, false);
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
            previewImg.src = getImageUrl(stillPath);
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
        chevron.src = isCollapsed ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
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

    const canSwitchToTvdb = !!show.tvdb_id;
    const canSwitchToTmdb = !!show.tmdb_id;
    const aliases = show.aliases || [];

    modalTitle.textContent = 'Edit Show Settings';
    modalBody.innerHTML = `
        <div class="add-show-tabs">
            <button class="tab-btn active" id="edit-tab-settings" onclick="switchEditTab('settings')">Settings</button>
            <button class="tab-btn" id="edit-tab-aliases" onclick="switchEditTab('aliases')">Custom Names</button>
        </div>
        <div class="edit-panels" style="position: relative;">
            <div id="edit-panel-settings">
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
                <div class="form-group">
                    <label>Metadata Source</label>
                    <div class="metadata-source-options">
                        <label>
                            <input type="radio" name="modal-metadata-source" value="tmdb" ${show.metadata_source === 'tmdb' ? 'checked' : ''} ${!canSwitchToTmdb && show.metadata_source !== 'tmdb' ? 'disabled' : ''} onchange="toggleSeasonTypeVisibility()">
                            TMDB
                        </label>
                        <label>
                            <input type="radio" name="modal-metadata-source" value="tvdb" ${show.metadata_source === 'tvdb' ? 'checked' : ''} ${!canSwitchToTvdb && show.metadata_source !== 'tvdb' ? 'disabled' : ''} onchange="toggleSeasonTypeVisibility()">
                            TVDB
                        </label>
                    </div>
                    ${!canSwitchToTvdb && show.metadata_source === 'tmdb' ? '<small class="text-muted">No TVDB ID available for this show</small>' : ''}
                    ${!canSwitchToTmdb && show.metadata_source === 'tvdb' ? '<small class="text-muted">No TMDB ID available for this show</small>' : ''}
                </div>
                <div class="form-group" id="season-type-group" style="display: ${show.metadata_source === 'tvdb' && show.tvdb_id ? 'block' : 'none'};">
                    <label>Episode Order</label>
                    <select id="modal-season-type" class="form-control" data-original="${escapeHtml(show.tvdb_season_type || 'official')}">
                        <option value="${escapeHtml(show.tvdb_season_type || 'official')}">${escapeHtml(show.tvdb_season_type || 'official')} (current)</option>
                    </select>
                    <small class="text-muted" id="season-type-loading">Loading available orderings...</small>
                </div>
            </div>
            <div id="edit-panel-aliases" style="display: none; position: absolute; top: 0; left: 0; right: 0;">
                <p class="text-muted" style="margin-bottom: 12px;">Add alternative names for this show. The watcher and scanner will use these when matching filenames.</p>
                <div id="aliases-list" style="margin-bottom: 12px;">
                    ${aliases.map(a => `
                        <div class="alias-item" style="display: flex; align-items: center; gap: 8px; margin-bottom: 6px;">
                            <span class="form-control" style="flex: 1;">${escapeHtml(a)}</span>
                            <button class="btn btn-sm btn-danger" onclick="this.parentElement.remove()" title="Remove">&times;</button>
                        </div>
                    `).join('')}
                </div>
                <div style="display: flex; gap: 8px;">
                    <input type="text" id="new-alias-input" class="form-control" placeholder="Enter an alternative name..." style="flex: 1;" onkeydown="if(event.key==='Enter'){event.preventDefault();addAlias();}">
                    <button class="btn btn-secondary" onclick="addAlias()">Add</button>
                </div>
            </div>
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="saveShowSettings(${showId})">Save</button>
        </div>
    `;

    modal.classList.add('active');

    // Fetch season types for TVDB shows
    if (show.metadata_source === 'tvdb' && show.tvdb_id) {
        _loadSeasonTypes(show.tvdb_id, show.tvdb_season_type || 'official');
    }
}

function switchEditTab(tab) {
    // Update tab buttons
    document.getElementById('edit-tab-settings').classList.toggle('active', tab === 'settings');
    document.getElementById('edit-tab-aliases').classList.toggle('active', tab === 'aliases');

    const settingsPanel = document.getElementById('edit-panel-settings');
    const aliasesPanel = document.getElementById('edit-panel-aliases');

    if (tab === 'settings') {
        settingsPanel.style.visibility = '';
        aliasesPanel.style.display = 'none';
    } else {
        // Settings stays in flow (visibility:hidden) so it holds height
        settingsPanel.style.visibility = 'hidden';
        aliasesPanel.style.display = '';
    }
}

function addAlias() {
    const input = document.getElementById('new-alias-input');
    const value = input.value.trim();
    if (!value) return;

    // Check for duplicates
    const existing = document.querySelectorAll('#aliases-list .alias-item span:first-child');
    for (const el of existing) {
        if (el.textContent.trim().toLowerCase() === value.toLowerCase()) {
            input.value = '';
            return;
        }
    }

    const list = document.getElementById('aliases-list');
    const div = document.createElement('div');
    div.className = 'alias-item';
    div.style.cssText = 'display: flex; align-items: center; gap: 8px; margin-bottom: 6px;';
    div.innerHTML = `
        <span class="form-control" style="flex: 1;">${escapeHtml(value)}</span>
        <button class="btn btn-sm btn-danger" onclick="this.parentElement.remove()" title="Remove">&times;</button>
    `;
    list.appendChild(div);
    input.value = '';
    input.focus();
}

function toggleSeasonTypeVisibility() {
    const selectedSource = document.querySelector('input[name="modal-metadata-source"]:checked')?.value;
    const group = document.getElementById('season-type-group');
    if (group) {
        const show = state.currentShow;
        group.style.display = (selectedSource === 'tvdb' && show?.tvdb_id) ? 'block' : 'none';

        // Load season types if switching to TVDB and not yet loaded
        if (selectedSource === 'tvdb' && show?.tvdb_id) {
            const select = document.getElementById('modal-season-type');
            if (select && select.options.length <= 1) {
                _loadSeasonTypes(show.tvdb_id, show.tvdb_season_type || 'official');
            }
        }
    }
}

async function _loadSeasonTypes(tvdbId, currentType) {
    const select = document.getElementById('modal-season-type');
    const loadingHint = document.getElementById('season-type-loading');

    try {
        const data = await api(`/shows/tvdb/${tvdbId}/season-types`);
        const types = data.season_types || [];

        if (types.length > 0 && select) {
            select.innerHTML = types.map(st =>
                `<option value="${escapeHtml(st.type)}" ${st.type === currentType ? 'selected' : ''}>${escapeHtml(st.name)}</option>`
            ).join('');
        }
        if (loadingHint) loadingHint.style.display = 'none';
    } catch (e) {
        if (loadingHint) loadingHint.textContent = 'Could not load orderings';
    }
}

async function saveShowSettings(showId) {
    const folderPath = document.getElementById('modal-folder-path').value.trim();
    const seasonFormat = document.getElementById('modal-season-format').value.trim();
    const episodeFormat = document.getElementById('modal-episode-format').value.trim();
    const doRename = document.getElementById('modal-do-rename').checked;
    const doMissing = document.getElementById('modal-do-missing').checked;
    const selectedSource = document.querySelector('input[name="modal-metadata-source"]:checked')?.value;

    // Collect aliases from the DOM
    const aliasElements = document.querySelectorAll('#aliases-list .alias-item span:first-child');
    const aliases = Array.from(aliasElements).map(el => el.textContent.trim()).filter(a => a);

    try {
        // Save show settings
        await api(`/shows/${showId}`, {
            method: 'PUT',
            body: JSON.stringify({
                folder_path: folderPath || null,
                season_format: seasonFormat,
                episode_format: episodeFormat,
                do_rename: doRename,
                do_missing: doMissing,
                aliases: aliases
            })
        });

        // If metadata source changed, switch source
        if (selectedSource && state.currentShow && selectedSource !== state.currentShow.metadata_source) {
            showToast(`Switching to ${selectedSource.toUpperCase()}...`, 'info');
            const switchBody = { metadata_source: selectedSource };
            // If switching to TVDB and a season type was selected, include it
            if (selectedSource === 'tvdb') {
                const seasonTypeSelect = document.getElementById('modal-season-type');
                if (seasonTypeSelect) {
                    switchBody.tvdb_season_type = seasonTypeSelect.value;
                }
            }
            await api(`/shows/${showId}/switch-source`, {
                method: 'POST',
                body: JSON.stringify(switchBody)
            });
            showToast(`Switched to ${selectedSource.toUpperCase()}`, 'success');
        } else {
            // Check if season type changed (for TVDB shows staying on TVDB)
            const seasonTypeSelect = document.getElementById('modal-season-type');
            if (seasonTypeSelect && state.currentShow?.metadata_source === 'tvdb') {
                const newSeasonType = seasonTypeSelect.value;
                const originalSeasonType = seasonTypeSelect.dataset.original || 'official';
                if (newSeasonType !== originalSeasonType) {
                    showToast(`Switching to ${newSeasonType} ordering...`, 'info');
                    await api(`/shows/${showId}/switch-season-type`, {
                        method: 'POST',
                        body: JSON.stringify({ season_type: newSeasonType })
                    });
                    showToast(`Switched to ${newSeasonType} ordering`, 'success');
                } else {
                    showToast('Settings updated', 'success');
                }
            } else {
                showToast('Settings updated', 'success');
            }
        }

        closeModal();
        showShowDetail(showId, null, null, true);
    } catch (error) {
        // Error already shown
    }
}

// Add Show Modal
function showAddShowModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const defaultSource = state.settings?.default_metadata_source || 'tmdb';
    modalTitle.textContent = 'Add Show';
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Search for a show</label>
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="text" id="show-search-input" class="form-control" placeholder="Enter show name..." onkeyup="debounceSearch(event)" style="flex: 1;">
                <div class="search-source-toggle" id="modal-search-source-toggle">
                    <label class="${defaultSource === 'tmdb' ? 'active' : ''}" onclick="setModalSearchSource('tmdb', this)">
                        <input type="radio" name="modal-search-source" value="tmdb" ${defaultSource === 'tmdb' ? 'checked' : ''}>
                        <span>TMDB</span>
                    </label>
                    <label class="${defaultSource === 'tvdb' ? 'active' : ''}" onclick="setModalSearchSource('tvdb', this)">
                        <input type="radio" name="modal-search-source" value="tvdb" ${defaultSource === 'tvdb' ? 'checked' : ''}>
                        <span>TVDB</span>
                    </label>
                </div>
            </div>
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

function getModalSearchSource() {
    const checked = document.querySelector('input[name="modal-search-source"]:checked');
    return checked ? checked.value : (state.settings?.default_metadata_source || 'tmdb');
}

function setModalSearchSource(source, labelEl) {
    const toggle = document.getElementById('modal-search-source-toggle');
    if (toggle) {
        toggle.querySelectorAll('label').forEach(l => {
            l.classList.remove('active');
            const input = l.querySelector('input');
            if (input) input.checked = (input.value === source);
        });
        if (labelEl) labelEl.classList.add('active');
    }
    // Re-run search with new source
    const searchInput = document.getElementById('show-search-input');
    if (searchInput && searchInput.value.trim().length >= 2) {
        searchShows(searchInput.value.trim());
    }
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

    const searchSource = getModalSearchSource();
    const searchEndpoint = searchSource === 'tvdb'
        ? `/shows/search/tvdb?q=${encodeURIComponent(query)}`
        : `/shows/search/tmdb?q=${encodeURIComponent(query)}`;
    const placeholder = "data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>";

    try {
        const data = await api(searchEndpoint);

        if (data.results.length === 0) {
            resultsDiv.innerHTML = '<p class="text-muted text-center">No results found.</p>';
            return;
        }

        resultsDiv.innerHTML = data.results.slice(0, 10).map(show => {
            const showId = searchSource === 'tvdb' ? (show.tvdb_id || show.id) : show.id;
            const posterUrl = getImageUrlOrPlaceholder(show.poster_path);
            return `
            <div class="search-result-item" onclick="addShowFromSearch(${showId}, '${searchSource}')">
                <img src="${posterUrl}"
                     class="search-result-poster"
                     onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 60 90%22><rect fill=%22%23252542%22 width=%2260%22 height=%2290%22/></svg>'">
                <div class="search-result-info">
                    <h4>${escapeHtml(show.name)}</h4>
                    <p>${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                    <p>${escapeHtml((show.overview || '').substring(0, 100))}${(show.overview || '').length > 100 ? '...' : ''}</p>
                </div>
            </div>
            `;
        }).join('');
    } catch (error) {
        resultsDiv.innerHTML = '<p class="text-muted text-center">Search failed.</p>';
    }
}

async function addShowFromSearch(showId, source = 'tmdb') {
    // Check if we should scan library
    const scanLibraryCheckbox = document.getElementById('scan-library-checkbox');
    const shouldScanLibrary = scanLibraryCheckbox ? scanLibraryCheckbox.checked : false;

    // For TVDB shows, check if there are multiple season types to choose from
    if (source === 'tvdb') {
        try {
            const stData = await api(`/shows/tvdb/${showId}/season-types`);
            const seasonTypes = stData.season_types || [];

            if (seasonTypes.length > 1) {
                // Show season type picker modal
                _showSeasonTypePicker(showId, seasonTypes, shouldScanLibrary);
                return;
            }
            // If only 1 type (or none), proceed with default
        } catch (e) {
            // Graceful degradation — proceed with default "official"
        }
    }

    _addShowWithSeasonType(showId, source, null, shouldScanLibrary);
}

function _showSeasonTypePicker(tvdbId, seasonTypes, shouldScanLibrary) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Select Episode Order';
    modalBody.innerHTML = `
        <p class="text-muted mb-10">This show has multiple episode orderings. Choose which one to use:</p>
        <div class="season-type-options">
            ${seasonTypes.map((st, i) => `
                <label class="season-type-option" style="display: flex; align-items: center; gap: 10px; padding: 8px 0; cursor: pointer;">
                    <input type="radio" name="season-type-choice" value="${escapeHtml(st.type)}" ${i === 0 ? 'checked' : ''}>
                    <span>${escapeHtml(st.name)}</span>
                </label>
            `).join('')}
        </div>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
            <button class="btn btn-primary" onclick="_confirmSeasonTypeAndAdd(${tvdbId}, ${shouldScanLibrary})">Add Show</button>
        </div>
    `;
    modal.classList.add('active');
}

function _confirmSeasonTypeAndAdd(tvdbId, shouldScanLibrary) {
    const selected = document.querySelector('input[name="season-type-choice"]:checked');
    const seasonType = selected ? selected.value : 'official';
    closeModal();
    _addShowWithSeasonType(tvdbId, 'tvdb', seasonType, shouldScanLibrary);
}

async function _addShowWithSeasonType(showId, source, seasonType, shouldScanLibrary) {
    try {
        showToast('Adding show...', 'info');
        const body = source === 'tvdb'
            ? { tvdb_id: showId, metadata_source: 'tvdb', tvdb_season_type: seasonType }
            : { tmdb_id: showId, metadata_source: 'tmdb' };
        const newShow = await api('/shows', {
            method: 'POST',
            body: JSON.stringify(body)
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

    // Trigger single-show scan (only scans this show, not the entire library)
    await api(`/scan/show/${showId}`, { method: 'POST' });

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
                    showShowDetail(showId, null, null, true);
                }, 1500);
            }
        } catch (error) {
            closeScanningModal();
            showShowDetail(showId, null, null, true);
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


// ── Fix Match ────────────────────────────────────────────────────

let _fixMatchState = {
    sourceShowId: null,
    selectedFiles: [],
    targetShowId: null,
    targetShowName: null,
    targetEpisodes: [],
    matches: [],
};

function getSelectedExtraFiles() {
    const checked = document.querySelectorAll('.extra-file-checkbox:checked');
    return Array.from(checked).map(cb => ({
        path: cb.dataset.path,
        filename: cb.dataset.filename,
    }));
}

function updateFixMatchButton() {
    const btn = document.getElementById('fix-match-btn');
    if (!btn) return;
    const selected = getSelectedExtraFiles();
    btn.disabled = selected.length === 0;
    btn.textContent = selected.length > 0 ? `Fix Match (${selected.length})` : 'Fix Match';

    // Keep select-all checkbox in sync
    const selectAll = document.getElementById('extra-file-select-all');
    if (selectAll) {
        const all = document.querySelectorAll('.extra-file-checkbox');
        selectAll.checked = all.length > 0 && selected.length === all.length;
        selectAll.indeterminate = selected.length > 0 && selected.length < all.length;
    }
}

function toggleAllExtraFiles(checked) {
    document.querySelectorAll('.extra-file-checkbox').forEach(cb => cb.checked = checked);
    updateFixMatchButton();
}

function toggleExtraFileCheckbox(headerEl) {
    const cb = headerEl.querySelector('.extra-file-checkbox');
    if (cb) {
        cb.checked = !cb.checked;
        updateFixMatchButton();
    }
}


// Step 1: Search for target show
let _fixMatchSearchTimeout;

function _fixMatchStep1_SearchShow(sourceShowId) {
    const selected = getSelectedExtraFiles();
    if (selected.length === 0) return;

    _fixMatchState = {
        sourceShowId,
        selectedFiles: selected,
        targetShowId: null,
        targetShowName: null,
        targetEpisodes: [],
        matches: [],
    };

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const defaultSource = state.settings?.default_metadata_source || 'tmdb';
    modalTitle.textContent = 'Fix Match - Select Target Show';
    modalBody.innerHTML = `
        <p class="text-muted mb-10">${selected.length} file${selected.length !== 1 ? 's' : ''} selected</p>
        <div class="form-group">
            <label>Search for the target show</label>
            <div style="display: flex; align-items: center; gap: 10px;">
                <input type="text" id="fix-match-search-input" class="form-control" placeholder="Enter show name..." oninput="_fixMatchDebounceSearch()" style="flex: 1;">
                <div class="search-source-toggle" id="fix-match-source-toggle">
                    <label class="${defaultSource === 'tmdb' ? 'active' : ''}" onclick="_fixMatchSetSource('tmdb', this)">
                        <input type="radio" name="fix-match-source" value="tmdb" ${defaultSource === 'tmdb' ? 'checked' : ''}>
                        <span>TMDB</span>
                    </label>
                    <label class="${defaultSource === 'tvdb' ? 'active' : ''}" onclick="_fixMatchSetSource('tvdb', this)">
                        <input type="radio" name="fix-match-source" value="tvdb" ${defaultSource === 'tvdb' ? 'checked' : ''}>
                        <span>TVDB</span>
                    </label>
                </div>
            </div>
        </div>
        <div id="fix-match-search-results" class="search-results"></div>
    `;
    modal.classList.add('active');

    // Focus search input
    setTimeout(() => document.getElementById('fix-match-search-input')?.focus(), 100);
}

function _fixMatchGetSource() {
    const checked = document.querySelector('input[name="fix-match-source"]:checked');
    return checked ? checked.value : (state.settings?.default_metadata_source || 'tmdb');
}

function _fixMatchSetSource(source, labelEl) {
    const toggle = document.getElementById('fix-match-source-toggle');
    if (toggle) {
        toggle.querySelectorAll('label').forEach(l => {
            l.classList.remove('active');
            const input = l.querySelector('input');
            if (input) input.checked = (input.value === source);
        });
        if (labelEl) labelEl.classList.add('active');
    }
    const searchInput = document.getElementById('fix-match-search-input');
    if (searchInput && searchInput.value.trim().length >= 2) {
        _fixMatchDoSearch(searchInput.value.trim());
    }
}

function _fixMatchDebounceSearch() {
    clearTimeout(_fixMatchSearchTimeout);
    const query = document.getElementById('fix-match-search-input')?.value.trim();
    if (!query || query.length < 2) {
        document.getElementById('fix-match-search-results').innerHTML = '';
        return;
    }
    _fixMatchSearchTimeout = setTimeout(() => _fixMatchDoSearch(query), 300);
}

async function _fixMatchDoSearch(query) {
    const resultsDiv = document.getElementById('fix-match-search-results');
    if (!resultsDiv) return;
    resultsDiv.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const source = _fixMatchGetSource();

    try {
        // Fetch library shows and provider results
        const [localResp, providerResp] = await Promise.all([
            api('/shows'),
            api(`/shows/search/${source}?q=${encodeURIComponent(query)}`),
        ]);

        const localShows = localResp.shows || [];
        const providerResults = providerResp.results || [];
        const queryLower = query.toLowerCase();

        // Filter library shows by name
        const matchingLocal = localShows.filter(s => s.name.toLowerCase().includes(queryLower));

        let html = '';

        // Library shows first (clickable)
        if (matchingLocal.length > 0) {
            html += '<div style="margin-bottom:8px;"><strong class="text-muted" style="font-size:0.85rem;">IN YOUR LIBRARY</strong></div>';
            html += matchingLocal.map(show => `
                <div class="search-result-item" onclick="_fixMatchSelectShow(${show.id}, '${escapeHtml(show.name).replace(/'/g, "\\'")}')">
                    <img src="${getImageUrlOrPlaceholder(show.poster_path)}" class="search-result-poster"
                         onerror="this.src='${getImageUrlOrPlaceholder(null)}'">
                    <div class="search-result-info">
                        <h4>${escapeHtml(show.name)}</h4>
                        <p>${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                    </div>
                    <span class="badge badge-success" style="margin-left:auto;">In Library</span>
                </div>
            `).join('');
        }

        // Provider results (grayed out if not in library)
        if (providerResults.length > 0) {
            html += '<div style="margin-bottom:8px;margin-top:12px;"><strong class="text-muted" style="font-size:0.85rem;">SEARCH RESULTS</strong></div>';
            html += providerResults.slice(0, 8).map(show => {
                const showId = source === 'tvdb' ? (show.tvdb_id || show.id) : show.id;
                const inLibrary = source === 'tvdb'
                    ? localShows.some(ls => ls.tvdb_id === showId)
                    : localShows.some(ls => ls.tmdb_id === showId);

                if (inLibrary) {
                    // Find library show to get its local ID
                    const libShow = source === 'tvdb'
                        ? localShows.find(ls => ls.tvdb_id === showId)
                        : localShows.find(ls => ls.tmdb_id === showId);
                    return `
                        <div class="search-result-item" onclick="_fixMatchSelectShow(${libShow.id}, '${escapeHtml(libShow.name).replace(/'/g, "\\'")}')">
                            <img src="${getImageUrlOrPlaceholder(show.poster_path)}" class="search-result-poster"
                                 onerror="this.src='${getImageUrlOrPlaceholder(null)}'">
                            <div class="search-result-info">
                                <h4>${escapeHtml(show.name)}</h4>
                                <p>${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                            </div>
                            <span class="badge badge-success" style="margin-left:auto;">In Library</span>
                        </div>
                    `;
                } else {
                    return `
                        <div class="search-result-item" onclick="_fixMatchAddAndSelectShow(${showId}, '${escapeHtml(show.name).replace(/'/g, "\\'")}', '${source}')">
                            <img src="${getImageUrlOrPlaceholder(show.poster_path)}" class="search-result-poster"
                                 onerror="this.src='${getImageUrlOrPlaceholder(null)}'">
                            <div class="search-result-info">
                                <h4>${escapeHtml(show.name)}</h4>
                                <p>${show.first_air_date ? show.first_air_date.substring(0, 4) : 'Unknown year'}</p>
                            </div>
                            <span class="badge badge-primary" style="margin-left:auto;">+ Add & Select</span>
                        </div>
                    `;
                }
            }).join('');
        }

        if (!html) {
            html = '<p class="text-muted text-center">No results found.</p>';
        }

        resultsDiv.innerHTML = html;
    } catch (error) {
        resultsDiv.innerHTML = '<p class="text-muted text-center">Search failed.</p>';
    }
}

async function _fixMatchSelectShow(showId, showName) {
    _fixMatchState.targetShowId = showId;
    _fixMatchState.targetShowName = showName;

    // Fetch target show's episodes
    try {
        const showData = await api(`/shows/${showId}`);
        _fixMatchState.targetEpisodes = showData.episodes || [];

        if (_fixMatchState.selectedFiles.length === 1) {
            _fixMatchStep2a_PickEpisode();
        } else {
            _fixMatchStep2b_PickSeason();
        }
    } catch (error) {
        showToast('Failed to load target show episodes', 'error');
    }
}

async function _fixMatchAddAndSelectShow(providerId, showName, source) {
    const modalBody = document.getElementById('modal-body');
    modalBody.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spinner" style="margin:0 auto 15px;"></div>
            <p>Adding <strong>${escapeHtml(showName)}</strong> to library...</p>
        </div>
    `;

    try {
        // Add the show to the library
        const body = source === 'tvdb'
            ? { tvdb_id: providerId, metadata_source: 'tvdb' }
            : { tmdb_id: providerId, metadata_source: 'tmdb' };
        const newShow = await api('/shows', {
            method: 'POST',
            body: JSON.stringify(body),
        });

        // If no folder_path, auto-generate from library folders
        if (!newShow.folder_path) {
            try {
                const folders = await api('/folders');
                const libraryFolder = folders.find(f => f.type === 'library' && f.enabled);
                if (libraryFolder) {
                    const folderPath = libraryFolder.path.replace(/\/+$/, '') + '/' + newShow.name;
                    await api(`/shows/${newShow.id}`, {
                        method: 'PUT',
                        body: JSON.stringify({ folder_path: folderPath }),
                    });
                }
            } catch (e) {
                // Non-fatal: user can set folder later, but preview will warn
            }
        }

        showToast(`Added "${newShow.name}" to library`, 'success');
        _fixMatchSelectShow(newShow.id, newShow.name);
    } catch (error) {
        // api() already shows toast; re-render search so user can try again
        _fixMatchStep1_SearchShow(_fixMatchState.sourceShowId);
    }
}


// Step 2a: Single file - pick exact episode
function _fixMatchStep2a_PickEpisode() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    const file = _fixMatchState.selectedFiles[0];
    const episodes = _fixMatchState.targetEpisodes;

    modalTitle.textContent = 'Fix Match - Pick Episode';
    modal.classList.add('modal-wide');

    // Group episodes by season
    const seasons = {};
    episodes.forEach(ep => {
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
                        const hasFile = ep.file_path && ep.file_status !== 'missing';
                        const airDate = ep.air_date || 'TBA';
                        if (hasFile) {
                            return `
                                <div class="preview-episode-row" style="opacity:0.4;cursor:default;">
                                    <div class="preview-episode-header">
                                        <span class="preview-ep-num">${ep.episode}</span>
                                        <span class="preview-ep-title">${escapeHtml(ep.title || 'TBA')}</span>
                                        <span class="preview-ep-air text-muted">${airDate}</span>
                                        <span class="badge badge-success" style="font-size:0.75rem;">Has File</span>
                                    </div>
                                </div>`;
                        }
                        return `
                            <div class="preview-episode-row" style="cursor:pointer;" onclick="_fixMatchPickSingleEpisode(${ep.season}, ${ep.episode})">
                                <div class="preview-episode-header">
                                    <span class="preview-ep-num">${ep.episode}</span>
                                    <span class="preview-ep-title">${escapeHtml(ep.title || 'TBA')}</span>
                                    <span class="preview-ep-air text-muted">${airDate}</span>
                                </div>
                            </div>`;
                    }).join('')}
                </div>
            </div>`;
    }).join('');

    modalBody.innerHTML = `
        <div style="margin-bottom:12px;">
            <strong>File:</strong> <code style="font-size:0.85rem;">${escapeHtml(file.filename)}</code>
        </div>
        <div style="margin-bottom:8px;">
            <strong>Target:</strong> ${escapeHtml(_fixMatchState.targetShowName)}
        </div>
        <p class="text-muted mb-10" style="font-size:0.85rem;">Click an episode to assign this file to it. Episodes with existing files are grayed out.</p>
        <div class="preview-seasons">
            ${seasonsHtml || '<p class="text-muted">No episodes found.</p>'}
        </div>
        <div class="modal-buttons" style="margin-top:15px;">
            <button class="btn btn-secondary" onclick="_fixMatchStep1_SearchShow(${_fixMatchState.sourceShowId})">Back</button>
        </div>
    `;
}

function _fixMatchPickSingleEpisode(season, episode) {
    _fixMatchState.matches = [{
        source_path: _fixMatchState.selectedFiles[0].path,
        target_season: season,
        target_episode: episode,
    }];
    _fixMatchStep3_Preview();
}


// Step 2b: Multiple files - pick season + ordering
function _fixMatchStep2b_PickSeason() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');
    const episodes = _fixMatchState.targetEpisodes;

    modalTitle.textContent = 'Fix Match - Pick Season & Order';

    // Group episodes by season (including specials)
    const seasons = {};
    episodes.forEach(ep => {
        if (!seasons[ep.season]) seasons[ep.season] = [];
        seasons[ep.season].push(ep);
    });
    const seasonNums = Object.keys(seasons).map(Number).sort((a, b) => a - b);

    // "All Seasons" summary (non-specials only)
    const allRegularEps = seasonNums.filter(s => s > 0).flatMap(sNum => seasons[sNum]);
    const allRegularMissing = allRegularEps.filter(e => !e.file_path || e.file_status === 'missing').length;
    const allOption = `<option value="all">All Seasons (${allRegularEps.length} episodes, ${allRegularMissing} missing)</option>`;

    const seasonOptions = allOption + seasonNums.map(sNum => {
        const eps = seasons[sNum];
        const missingCount = eps.filter(e => !e.file_path || e.file_status === 'missing').length;
        const label = sNum === 0 ? 'Specials' : `Season ${sNum}`;
        return `<option value="${sNum}">${label} (${eps.length} episodes, ${missingCount} missing)</option>`;
    }).join('');

    modalBody.innerHTML = `
        <div style="margin-bottom:12px;">
            <strong>${_fixMatchState.selectedFiles.length} files</strong> to match into <strong>${escapeHtml(_fixMatchState.targetShowName)}</strong>
        </div>
        <div class="form-group">
            <label>Target Season</label>
            <select id="fix-match-season-select" class="form-control">
                ${seasonOptions || '<option disabled>No seasons available</option>'}
            </select>
        </div>
        <div class="form-group">
            <label>Match Ordering</label>
            <div style="display:flex;flex-direction:column;gap:8px;">
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="radio" name="fix-match-ordering" value="alphabetical" checked>
                    <span><strong>Alphabetical</strong> - Sort files by name, assign sequentially to missing episodes</span>
                </label>
                <label style="display:flex;align-items:center;gap:8px;cursor:pointer;">
                    <input type="radio" name="fix-match-ordering" value="parse">
                    <span><strong>Parse numbers</strong> - Extract episode numbers from filenames (SxxExx, NxNN)</span>
                </label>
            </div>
        </div>
        <div class="modal-buttons" style="margin-top:15px;">
            <button class="btn btn-secondary" onclick="_fixMatchStep1_SearchShow(${_fixMatchState.sourceShowId})">Back</button>
            <button class="btn btn-primary" onclick="_fixMatchBuildMultiMatches()">Next</button>
        </div>
    `;
}

function _fixMatchBuildMultiMatches() {
    const seasonRaw = document.getElementById('fix-match-season-select')?.value;
    const ordering = document.querySelector('input[name="fix-match-ordering"]:checked')?.value || 'alphabetical';
    const isAll = seasonRaw === 'all';
    const seasonNum = isAll ? null : parseInt(seasonRaw);

    if (!isAll && isNaN(seasonNum)) {
        showToast('Please select a season', 'warning');
        return;
    }

    const episodes = _fixMatchState.targetEpisodes;
    const missingEps = episodes
        .filter(ep => (isAll ? ep.season > 0 : ep.season === seasonNum)
            && (!ep.file_path || ep.file_status === 'missing'))
        .sort((a, b) => a.season - b.season || a.episode - b.episode);

    const files = [..._fixMatchState.selectedFiles];
    const matches = [];

    if (ordering === 'alphabetical') {
        files.sort((a, b) => a.filename.localeCompare(b.filename));
        for (let i = 0; i < files.length && i < missingEps.length; i++) {
            matches.push({
                source_path: files[i].path,
                target_season: missingEps[i].season,
                target_episode: missingEps[i].episode,
            });
        }
    } else {
        // Parse season+episode numbers from filenames
        const seRegex = /[Ss](\d+)[Ee](\d+)/;
        const nxRegex = /(\d+)[xX](\d+)/;
        const simpleRegex = /[Ee](\d+)/;

        for (const file of files) {
            let sNum = null, epNum = null;
            const seMatch = file.filename.match(seRegex);
            if (seMatch) {
                sNum = parseInt(seMatch[1]);
                epNum = parseInt(seMatch[2]);
            } else {
                const nxMatch = file.filename.match(nxRegex);
                if (nxMatch) {
                    sNum = parseInt(nxMatch[1]);
                    epNum = parseInt(nxMatch[2]);
                } else {
                    const simpleMatch = file.filename.match(simpleRegex);
                    if (simpleMatch) {
                        epNum = parseInt(simpleMatch[1]);
                    }
                }
            }

            if (epNum !== null) {
                // When a single season is selected, use it; otherwise use parsed season
                const targetSeason = isAll ? sNum : seasonNum;
                if (targetSeason === null) continue;
                const targetEp = missingEps.find(e => e.season === targetSeason && e.episode === epNum);
                if (targetEp) {
                    matches.push({
                        source_path: file.path,
                        target_season: targetSeason,
                        target_episode: epNum,
                    });
                }
            }
        }
    }

    if (matches.length === 0) {
        showToast('No matches could be determined. Try a different ordering or season.', 'warning');
        return;
    }

    _fixMatchState.matches = matches;
    _fixMatchStep3_Preview();
}


// Step 3: Preview
async function _fixMatchStep3_Preview() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Fix Match - Preview';
    modal.classList.add('modal-wide');
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const preview = await api(`/shows/${_fixMatchState.sourceShowId}/fix-match/preview`, {
            method: 'POST',
            body: JSON.stringify({
                target_show_id: _fixMatchState.targetShowId,
                matches: _fixMatchState.matches,
            }),
        });

        const rows = preview.results.map(r => {
            let statusBadge;
            if (r.error && r.conflict) {
                statusBadge = '<span class="badge badge-danger">Conflict</span>';
            } else if (r.error) {
                statusBadge = `<span class="badge badge-danger">Error</span>`;
            } else {
                statusBadge = '<span class="badge badge-success">OK</span>';
            }

            return `
                <tr>
                    <td style="font-size:0.85rem;word-break:break-all;">${escapeHtml(r.source_filename)}</td>
                    <td style="font-size:0.85rem;">${escapeHtml(r.target_episode_name || '-')}</td>
                    <td>${statusBadge}</td>
                </tr>
            `;
        }).join('');

        const backStep = _fixMatchState.selectedFiles.length === 1 ? '_fixMatchStep2a_PickEpisode' : '_fixMatchStep2b_PickSeason';

        modalBody.innerHTML = `
            <div style="margin-bottom:12px;">
                <strong>Target:</strong> ${escapeHtml(preview.target_show_name)}
            </div>
            <div style="overflow-x:auto;">
                <table class="table" style="width:100%;border-collapse:collapse;">
                    <thead>
                        <tr>
                            <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color);">Source File</th>
                            <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color);">Target Episode</th>
                            <th style="text-align:left;padding:8px;border-bottom:1px solid var(--border-color);">Status</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${rows}
                    </tbody>
                </table>
            </div>
            ${preview.has_conflicts ? '<p class="text-muted" style="color:var(--danger-color);margin-top:10px;">Cannot proceed: one or more episodes already have files.</p>' : ''}
            <div class="modal-buttons" style="margin-top:15px;">
                <button class="btn btn-secondary" onclick="${backStep}()">Back</button>
                <button class="btn btn-primary" onclick="_fixMatchExecute()" ${preview.has_conflicts ? 'disabled' : ''}>Confirm & Move Files</button>
            </div>
        `;
    } catch (error) {
        modalBody.innerHTML = `
            <p class="text-muted">Preview failed.</p>
            <div class="modal-buttons" style="margin-top:15px;">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        `;
    }
}


// Step 4: Execute
async function _fixMatchExecute() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Fix Match - Processing';
    modalBody.innerHTML = `
        <div style="text-align:center;padding:20px;">
            <div class="spinner" style="margin:0 auto 15px;"></div>
            <p>Moving files...</p>
        </div>
    `;

    try {
        const result = await api(`/shows/${_fixMatchState.sourceShowId}/fix-match`, {
            method: 'POST',
            body: JSON.stringify({
                target_show_id: _fixMatchState.targetShowId,
                matches: _fixMatchState.matches,
            }),
        });

        modalTitle.textContent = 'Fix Match - Complete';
        modalBody.innerHTML = `
            <div class="refresh-summary" style="margin-bottom:15px;">
                <div class="refresh-stat refresh-stat-success">
                    <span class="refresh-stat-number">${result.success_count}</span>
                    <span class="refresh-stat-label">Moved</span>
                </div>
                <div class="refresh-stat refresh-stat-error">
                    <span class="refresh-stat-number">${result.error_count}</span>
                    <span class="refresh-stat-label">Errors</span>
                </div>
            </div>
            ${result.error_count > 0 ? `
                <div style="margin-bottom:10px;">
                    ${result.results.filter(r => !r.success).map(r => `
                        <p class="text-muted" style="font-size:0.85rem;color:var(--danger-color);">${escapeHtml(r.source_filename)}: ${escapeHtml(r.error)}</p>
                    `).join('')}
                </div>
            ` : ''}
            <div class="modal-buttons">
                <button class="btn btn-primary" onclick="closeModal(); showShowDetail(${_fixMatchState.sourceShowId}, null, null, true);">Done</button>
            </div>
        `;
    } catch (error) {
        modalTitle.textContent = 'Fix Match - Error';
        modalBody.innerHTML = `
            <p class="text-muted">Fix match failed.</p>
            <div class="modal-buttons" style="margin-top:15px;">
                <button class="btn btn-secondary" onclick="closeModal()">Close</button>
            </div>
        `;
    }
}
