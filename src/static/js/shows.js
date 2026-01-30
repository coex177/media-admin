/**
 * Media Admin - Shows (list/detail, add/edit modals, pagination, metadata refresh)
 */

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

function renderShowListItem(show) {
    const totalAired = show.episodes_found + show.episodes_missing;

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
    return `<select class="shows-per-page-select" onchange="changeShowsPerPage(this.value)">
        ${[[50,'50'],[100,'100'],[300,'300'],[500,'500'],[1000,'1000'],[0,'All']].map(([v,l]) =>
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

    const canSwitchToTvdb = !!show.tvdb_id;
    const canSwitchToTmdb = !!show.tmdb_id;

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
        <div class="form-group">
            <label>Metadata Source</label>
            <div class="metadata-source-options">
                <label>
                    <input type="radio" name="modal-metadata-source" value="tmdb" ${show.metadata_source === 'tmdb' ? 'checked' : ''} ${!canSwitchToTmdb && show.metadata_source !== 'tmdb' ? 'disabled' : ''}>
                    TMDB
                </label>
                <label>
                    <input type="radio" name="modal-metadata-source" value="tvdb" ${show.metadata_source === 'tvdb' ? 'checked' : ''} ${!canSwitchToTvdb && show.metadata_source !== 'tvdb' ? 'disabled' : ''}>
                    TVDB
                </label>
            </div>
            ${!canSwitchToTvdb && show.metadata_source === 'tmdb' ? '<small class="text-muted">No TVDB ID available for this show</small>' : ''}
            ${!canSwitchToTmdb && show.metadata_source === 'tvdb' ? '<small class="text-muted">No TMDB ID available for this show</small>' : ''}
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
    const selectedSource = document.querySelector('input[name="modal-metadata-source"]:checked')?.value;

    try {
        // Save show settings
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

        // If metadata source changed, switch source
        if (selectedSource && state.currentShow && selectedSource !== state.currentShow.metadata_source) {
            showToast(`Switching to ${selectedSource.toUpperCase()}...`, 'info');
            await api(`/shows/${showId}/switch-source`, {
                method: 'POST',
                body: JSON.stringify({ metadata_source: selectedSource })
            });
            showToast(`Switched to ${selectedSource.toUpperCase()}`, 'success');
        } else {
            showToast('Settings updated', 'success');
        }

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
