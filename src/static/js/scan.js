/**
 * Media Admin - Scan (scan page, scan triggers, missing episodes, fix match)
 */

let activeScanTab = 'operations';

async function renderScan() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [actions, scanStatus, missingEpisodes, metadataUpdates, downloadMatches, settings] = await Promise.all([
            api('/actions'),
            api('/scan/status'),
            api('/scan/missing'),
            api('/scan/metadata-updates'),
            api('/scan/download-matches'),
            api('/settings')
        ]);
        state.actions = actions;
        state.settings = settings;

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Scan</h1>
            </div>

            <div class="scan-tabs">
                <button class="scan-tab ${activeScanTab === 'operations' ? 'active' : ''}" data-tab="operations" onclick="switchScanTab('operations')"><img src="/static/images/operations.png" class="tab-icon-img" alt="">Operations</button>
                <button class="scan-tab ${activeScanTab === 'watcher-log' ? 'active' : ''}" data-tab="watcher-log" onclick="switchScanTab('watcher-log')"><img src="/static/images/watcher-log.png" class="tab-icon-img" alt="">Watcher Log</button>
                <button class="scan-tab ${activeScanTab === 'library-log' ? 'active' : ''}" data-tab="library-log" onclick="switchScanTab('library-log')"><img src="/static/images/nav-lists.png" class="tab-icon-img" alt="">Library Log</button>
                <button class="scan-tab ${activeScanTab === 'ignored' ? 'active' : ''}" data-tab="ignored" onclick="switchScanTab('ignored')"><img src="/static/images/list-ignore.png" class="tab-icon-img" alt="">Ignored</button>
                <button class="scan-tab ${activeScanTab === 'issues' ? 'active' : ''}" data-tab="issues" onclick="switchScanTab('issues')"><img src="/static/images/issues.png" class="tab-icon-img" alt="">Issues</button>
            </div>

            <div id="scan-tab-content"></div>
        `;

        if (activeScanTab === 'operations') {
            renderScanOperationsTab(actions, scanStatus, missingEpisodes, metadataUpdates, downloadMatches, settings);
        } else if (activeScanTab === 'ignored') {
            renderIgnoredTab();
        } else if (activeScanTab === 'issues') {
            renderIssuesTab();
        } else if (activeScanTab === 'library-log') {
            renderLibraryLogTab();
        } else {
            renderWatcherLogTab();
        }

        restorePendingScroll();
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load scan page.</div>`;
    }
}

function switchScanTab(tab) {
    if (tab === activeScanTab) return;
    activeScanTab = tab;
    setUiPref('scanActiveTab', tab);

    document.querySelectorAll('.scan-tab').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    const container = document.getElementById('scan-tab-content');
    if (!container) return;

    if (tab === 'operations') {
        // Re-render full scan page to get fresh data
        renderScan();
    } else if (tab === 'ignored') {
        renderIgnoredTab();
    } else if (tab === 'issues') {
        renderIssuesTab();
    } else if (tab === 'library-log') {
        renderLibraryLogTab();
    } else {
        renderWatcherLogTab();
    }
}

function renderScanOperationsTab(actions, scanStatus, missingEpisodes, metadataUpdates, downloadMatches, settings) {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;
    const displayEpFormat = settings?.display_episode_format || '{season}x{episode:02d}';

    // Build download match lookup by episode_id
    const downloadMatchByEpId = {};
    downloadMatches.forEach((m, idx) => { m.globalIndex = idx; downloadMatchByEpId[m.episode_id] = m; });

    const hasPendingActions = actions.length > 0 && !scanStatus.running;
    const hasMetadataUpdates = metadataUpdates.length > 0 && !scanStatus.running;
    const hasMissingEpisodes = (missingEpisodes.length > 0 || downloadMatches.length > 0) && !scanStatus.running;
    const noDataAtAll = !scanStatus.running && !hasPendingActions && !hasMetadataUpdates && !hasMissingEpisodes;

    container.innerHTML = `
        <!-- Show Operations -->
        ${(() => {
            const showOpsCollapsed = getUiPref('showOpsCardCollapsed', false);
            return `
        <div class="card mb-20 ${showOpsCollapsed ? 'card-collapsed' : ''}" id="show-operations-card">
            <div class="card-header" onclick="toggleScanCard('show-operations-card', 'showOpsCardCollapsed')" style="cursor: pointer;">
                <div class="card-header-left">
                    <img src="/static/images/${showOpsCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="card-collapse-chevron" alt="">
                    <h3 class="card-title">Show Operations</h3>
                </div>
            </div>
            <div class="card-body-collapsible ${showOpsCollapsed ? '' : 'open'}">
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
                    <p class="scan-description">Scan only selected shows/episodes from the lists below.</p>
                </div>
            </div>
            </div>
        </div>`;
        })()}

        <!-- Movie Operations -->
        ${(() => {
            const movieOpsCollapsed = getUiPref('movieOpsCardCollapsed', false);
            return `
        <div class="card mb-20 ${movieOpsCollapsed ? 'card-collapsed' : ''}" id="movie-operations-card">
            <div class="card-header" onclick="toggleScanCard('movie-operations-card', 'movieOpsCardCollapsed')" style="cursor: pointer;">
                <div class="card-header-left">
                    <img src="/static/images/${movieOpsCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="card-collapse-chevron" alt="">
                    <h3 class="card-title">Movie Operations</h3>
                </div>
            </div>
            <div class="card-body-collapsible ${movieOpsCollapsed ? '' : 'open'}">
            <div class="scan-buttons">
                <div class="scan-button-group">
                    <button class="btn btn-primary btn-lg" onclick="triggerMovieLibraryScan()" id="scan-movies-btn" ${scanStatus.running ? 'disabled' : ''}>
                        Scan Movie Library
                    </button>
                    <p class="scan-description">Match files in movie library folders to existing movies.</p>
                </div>
                <div class="scan-button-group">
                    <button class="btn btn-secondary btn-lg" onclick="showMovieDiscoveryModal()" id="scan-movie-discover-btn" ${scanStatus.running ? 'disabled' : ''}>
                        Discover Movies
                    </button>
                    <p class="scan-description">Discover and add movies from a library folder.</p>
                </div>
                <div class="scan-button-group">
                    <button class="btn btn-secondary btn-lg" onclick="showMovieRenamePreviewsModal()" id="scan-movie-renames-btn" ${scanStatus.running ? 'disabled' : ''}>
                        Movie Rename Previews
                    </button>
                    <p class="scan-description">Preview and apply pending movie file renames.</p>
                </div>
            </div>
            </div>
        </div>`;
        })()}

        <!-- Scan Progress -->
        ${scanStatus.running ? `
            <div class="card mb-20" id="scan-results-card">
                <div class="card-header">
                    <h3 class="card-title" id="results-title">Scanning...</h3>
                </div>
                <div id="scan-results-content">
                    <div class="scan-progress-area">
                        <div class="scan-progress-spinner"></div>
                        <div class="scan-progress-text">${escapeHtml(scanStatus.message || 'Scanning...')}</div>
                        <div class="progress-bar-container mt-10">
                            <div class="progress-bar-fill" style="width: ${scanStatus.progress}%"></div>
                        </div>
                    </div>
                </div>
            </div>
        ` : ''}

        <!-- Pending Actions -->
        ${hasPendingActions ? `
            <div class="card mb-20">
                <div class="card-header flex flex-between">
                    <h3 class="card-title">Pending Actions</h3>
                    <button class="btn btn-success" onclick="approveAllActions()">Approve All</button>
                </div>
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
            </div>
        ` : ''}

        <!-- Metadata Updates (File Renames) -->
        ${hasMetadataUpdates ? renderMetadataUpdatesCard(metadataUpdates) : ''}

        <!-- Missing Episodes -->
        ${hasMissingEpisodes ? renderMissingEpisodesCard(missingEpisodes, downloadMatchByEpId, settings) : ''}

        <!-- Empty State -->
        ${noDataAtAll ? `
            <div class="card">
                <div class="empty-state" style="padding: 40px 20px;">
                    <div class="empty-state-icon">&#10003;</div>
                    <h3>All Caught Up</h3>
                    <p>No pending actions, renames, or missing episodes. Your library is complete!</p>
                </div>
            </div>
        ` : ''}
    `;

    // Initialize selection counts after render
    if (hasMetadataUpdates) updateRenameSelectionCount();
    if (hasMissingEpisodes) updateMissingSelectionCount();
}

function renderMetadataUpdatesCard(metadataUpdates) {
    // Group by show
    const showGroups = {};
    metadataUpdates.forEach((update, idx) => {
        update._globalIndex = idx;
        if (!showGroups[update.show_id]) {
            showGroups[update.show_id] = { show_name: update.show_name, show_id: update.show_id, items: [] };
        }
        showGroups[update.show_id].items.push(update);
    });
    const groups = Object.values(showGroups).sort((a, b) => a.show_name.localeCompare(b.show_name));

    const renameState = getUiPref('renameCheckboxState', null);
    const cardCollapsed = getUiPref('metadataUpdatesCardCollapsed', false);

    return `
        <div class="card mb-20 ${cardCollapsed ? 'card-collapsed' : ''}" id="metadata-updates-card">
            <div class="card-header" onclick="toggleScanCard('metadata-updates-card', 'metadataUpdatesCardCollapsed')" style="cursor: pointer;">
                <div class="card-header-left">
                    <img src="/static/images/${cardCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="card-collapse-chevron" alt="">
                    <h3 class="card-title">Metadata Updates</h3>
                </div>
                <div class="card-header-actions" onclick="event.stopPropagation()">
                    <span class="rename-selected-count" id="rename-selected-count">${metadataUpdates.length} selected</span>
                    <button class="btn btn-primary btn-sm" id="btn-apply-renames" onclick="applySelectedRenames()">Apply Renames</button>
                    <button class="card-control-btn" onclick="toggleAllRenameGroups(false)" title="Collapse all"><img src="/static/images/show-expand.png" alt="Collapse all"></button>
                    <button class="card-control-btn" onclick="toggleAllRenameGroups(true)" title="Expand all"><img src="/static/images/show-collapse.png" alt="Expand all"></button>
                </div>
            </div>
            <div class="card-body-collapsible ${cardCollapsed ? '' : 'open'}">
            <div class="missing-episodes-grouped">
                ${groups.map(group => {
                    const isCollapsed = getRenameGroupCollapseState(group.show_id);
                    return `
                    <div class="rename-show-group" data-show-id="${group.show_id}">
                        <div class="rename-show-header" onclick="toggleRenameShowGroup(this, ${group.show_id})">
                            <img src="/static/images/${isCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="rename-show-chevron" alt="">
                            <input type="checkbox" class="rename-show-select-all" ${renameState ? (group.items.every(item => renameState[item._globalIndex] !== false) ? 'checked' : '') : 'checked'} onclick="event.stopPropagation(); toggleAllRenamesInShow(this, ${group.show_id})" title="Select all">
                            <span class="rename-show-name">${escapeHtml(group.show_name)}</span>
                            <span class="rename-show-count">(${group.items.length} ${group.items.length === 1 ? 'rename' : 'renames'})</span>
                            <img src="/static/images/goto.png" class="rename-show-goto"
                                 onclick="event.stopPropagation(); showShowDetail(${group.show_id})"
                                 title="Go to ${escapeHtml(group.show_name)}" alt="Go to show">
                        </div>
                        <div class="rename-episodes-table-wrapper ${isCollapsed ? '' : 'open'}">
                            <table class="rename-episodes-table">
                                <thead>
                                    <tr>
                                        <th class="checkbox-col"></th>
                                        <th>Episode</th>
                                        <th>Current Filename</th>
                                        <th class="arrow-col"></th>
                                        <th>New Filename</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${group.items.map(item => `
                                        <tr class="rename-episode-row">
                                            <td class="checkbox-col">
                                                <input type="checkbox" class="rename-checkbox" ${renameState ? (renameState[item._globalIndex] !== false ? 'checked' : '') : 'checked'}
                                                       data-rename-index="${item._globalIndex}"
                                                       data-show-id="${group.show_id}"
                                                       onclick="event.stopPropagation(); updateRenameSelectionCount()">
                                            </td>
                                            <td>${escapeHtml(item.episode_code)}</td>
                                            <td class="filename-cell">
                                                <div class="filename-line" title="${escapeHtml(item.current_filename)}">${escapeHtml(item.current_filename)}</div>
                                                ${item.rename_type !== 'file' ? '<div class="folder-line" title="' + escapeHtml(item.current_folder) + '">' + escapeHtml(item.current_folder) + '</div>' : ''}
                                            </td>
                                            <td class="arrow-col">&rarr;</td>
                                            <td class="filename-cell">
                                                <div class="filename-line" title="${escapeHtml(item.expected_filename)}">${escapeHtml(item.expected_filename)}</div>
                                                ${item.rename_type !== 'file' ? '<div class="folder-line" title="' + escapeHtml(item.expected_folder) + '">' + escapeHtml(item.expected_folder) + '</div>' : ''}
                                            </td>
                                        </tr>
                                    `).join('')}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `}).join('')}
            </div>
            </div>
        </div>
    `;
}

function renderMissingEpisodesCard(missingEpisodes, downloadMatchByEpId, settings) {
    const hasDownloadMatches = Object.keys(downloadMatchByEpId).length > 0;
    const missingState = getUiPref('missingCheckboxState', null);

    const cardCollapsed = getUiPref('missingEpisodesCardCollapsed', false);

    return `
        <div class="card mb-20 ${cardCollapsed ? 'card-collapsed' : ''}" id="missing-episodes-card">
            <div class="card-header" onclick="toggleScanCard('missing-episodes-card', 'missingEpisodesCardCollapsed')" style="cursor: pointer;">
                <div class="card-header-left">
                    <img src="/static/images/${cardCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="card-collapse-chevron" alt="">
                    <h3 class="card-title">Missing Episodes</h3>
                </div>
                <div class="card-header-actions" onclick="event.stopPropagation()">
                    <span class="missing-selected-count" id="missing-selected-count">0 selected</span>
                    ${hasDownloadMatches ? `<button class="btn btn-success btn-sm" onclick="importCheckedDownloads()" id="btn-import-downloads">Import Episodes</button>` : ''}
                    <button class="btn btn-primary btn-sm" onclick="showFixMatchModal()" id="btn-fix-match" disabled>Fix Match</button>
                    <button class="btn btn-warning btn-sm" onclick="ignoreSelectedEpisodes()" id="btn-ignore" disabled>Ignore</button>
                    <button class="card-control-btn" onclick="toggleAllMissingGroups(false)" title="Collapse all"><img src="/static/images/show-expand.png" alt="Collapse all"></button>
                    <button class="card-control-btn" onclick="toggleAllMissingGroups(true)" title="Expand all"><img src="/static/images/show-collapse.png" alt="Expand all"></button>
                </div>
            </div>
            <div class="card-body-collapsible ${cardCollapsed ? '' : 'open'}">
            <div class="missing-episodes-grouped">
                ${missingEpisodes.map(show => {
                    const isCollapsed = getMissingGroupCollapseState(show.show_id);
                    const showEpIds = show.episodes.map(ep => ep.id);
                    const downloadEpIds = new Set(show.episodes.filter(ep => downloadMatchByEpId[ep.id]).map(ep => ep.id));
                    const allChecked = missingState
                        ? showEpIds.every(id => !!missingState[id])
                        : (downloadEpIds.size > 0 && downloadEpIds.size === showEpIds.length);
                    return `
                    <div class="missing-show-group" data-show-id="${show.show_id}">
                        <div class="missing-show-header" onclick="toggleMissingShowGroup(this, ${show.show_id})">
                            <img src="/static/images/${isCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="missing-show-chevron" alt="">
                            <input type="checkbox" class="missing-show-select-all" ${allChecked ? 'checked' : ''}
                                   onclick="event.stopPropagation(); toggleAllMissingInShow(this, ${show.show_id})"
                                   title="Select all">
                            <span class="missing-show-name">${escapeHtml(show.show_name)}</span>
                            <span class="missing-show-count">(${show.episodes.length} ${show.episodes.length === 1 ? 'item' : 'items'})</span>
                            <img src="/static/images/goto.png" class="missing-show-goto"
                                 onclick="event.stopPropagation(); showShowDetail(${show.show_id})"
                                 title="Go to ${escapeHtml(show.show_name)}" alt="Go to show">
                        </div>
                        <div class="missing-episodes-table-wrapper ${isCollapsed ? '' : 'open'}">
                            <table class="missing-episodes-table">
                                <thead>
                                    <tr>
                                        <th class="checkbox-col"></th>
                                        <th>Season</th>
                                        <th>Episode</th>
                                        <th>Air Date</th>
                                        <th>Filename</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    ${(() => {
                                        // Group episodes by season
                                        const seasonGroups = {};
                                        show.episodes.forEach(ep => {
                                            const s = ep.season;
                                            if (!seasonGroups[s]) seasonGroups[s] = [];
                                            seasonGroups[s].push(ep);
                                        });
                                        const seasonKeys = Object.keys(seasonGroups).sort((a, b) => a - b);
                                        return seasonKeys.map(seasonNum => {
                                            const eps = seasonGroups[seasonNum];
                                            const seasonKey = show.show_id + '-' + seasonNum;
                                            const seasonCollapsed = getMissingSeasonCollapseState(seasonKey);
                                            let rows = '';
                                            rows += '<tr class="missing-season-header" onclick="toggleMissingSeason(\'' + seasonKey + '\', this)">' +
                                                    '<td colspan="5" class="missing-season-header-cell">' +
                                                    '<img src="/static/images/' + (seasonCollapsed ? 'show-expand.png' : 'show-collapse.png') + '" class="missing-season-chevron" alt="">' +
                                                    ' Season ' + seasonNum +
                                                    '<span class="missing-season-count">(' + eps.length + ')</span>' +
                                                    '</td></tr>';
                                            eps.forEach(ep => {
                                                const match = downloadMatchByEpId[ep.id];
                                                const hasMatch = !!match;
                                                const isChecked = missingState ? !!missingState[ep.id] : hasMatch;
                                                rows += '<tr class="missing-episode-row' + (hasMatch ? ' download-match-row' : '') + (seasonCollapsed ? ' missing-season-hidden' : '') + '" data-season-key="' + seasonKey + '">' +
                                                    '<td class="checkbox-col"><input type="checkbox" class="episode-checkbox" ' + (isChecked ? 'checked ' : '') +
                                                    'data-show-id="' + show.show_id + '" data-episode-id="' + ep.id + '" data-show-name="' + escapeHtml(show.show_name) + '"' +
                                                    (hasMatch ? ' data-download-index="' + match.globalIndex + '"' : '') +
                                                    ' onclick="event.stopPropagation(); updateMissingSelectionCount()"></td>' +
                                                    '<td>' + ep.season + '</td>' +
                                                    '<td>' + ep.episode + '</td>' +
                                                    '<td>' + (ep.air_date || '-') + '</td>' +
                                                    '<td class="filename-cell">' +
                                                    '<div class="filename-line" onclick="showShowDetail(' + show.show_id + ', ' + ep.season + ', ' + ep.episode + ')" title="' + escapeHtml(ep.expected_filename) + '">' + escapeHtml(ep.expected_filename) + '</div>' +
                                                    '<div class="folder-line" title="' + escapeHtml(ep.expected_folder) + '">' + escapeHtml(ep.expected_folder) + '</div>' +
                                                    (hasMatch ? '<div class="download-match-line">Found: ' + escapeHtml(match.source_filename) + '</div>' : '') +
                                                    '</td>' +
                                                    '</tr>';
                                            });
                                            return rows;
                                        }).join('');
                                    })()}
                                </tbody>
                            </table>
                        </div>
                    </div>
                `}).join('')}
            </div>
            </div>
        </div>
    `;
}

// Scan with live progress updates
async function triggerFullScan() {
    clearScanCheckboxStates();
    try {
        await api('/scan', { method: 'POST' });
        showToast('Full scan started', 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

async function triggerQuickScan() {
    clearScanCheckboxStates();
    try {
        const result = await api('/scan/quick', { method: 'POST' });
        showToast(`Quick scan started (${result.days} days)`, 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

async function triggerOngoingScan() {
    clearScanCheckboxStates();
    try {
        await api('/scan/ongoing', { method: 'POST' });
        showToast('Ongoing shows scan started', 'info');
        pollScanStatusWithUI();
    } catch (error) {
        // Error already shown
    }
}

function triggerScanSelected() {
    clearScanCheckboxStates();
    const selectedEpisodes = getSelectedMissingEpisodes();
    const selectedRenameShowIds = getSelectedRenameShowIds();

    if (selectedEpisodes.length === 0 && selectedRenameShowIds.length === 0) {
        const missingSection = document.querySelector('.missing-episodes-grouped');
        if (missingSection) {
            missingSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
            showToast('Select shows/episodes from the lists below, then click Scan Selected', 'info');
        } else {
            showToast('No items to scan', 'info');
        }
        return;
    }
    scanSelectedItems(selectedEpisodes, selectedRenameShowIds);
}

function getSelectedRenameShowIds() {
    const showIds = new Set();
    document.querySelectorAll('.rename-checkbox:checked').forEach(cb => {
        showIds.add(parseInt(cb.dataset.showId));
    });
    return [...showIds];
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

    // Show progress in a dedicated card if not already visible
    let resultsCard = document.getElementById('scan-results-card');
    if (!resultsCard) {
        // Insert progress card after scan buttons
        const scanButtons = document.querySelector('.card.mb-20');
        if (scanButtons) {
            const progressCard = document.createElement('div');
            progressCard.className = 'card mb-20';
            progressCard.id = 'scan-results-card';
            progressCard.innerHTML = `
                <div class="card-header">
                    <h3 class="card-title" id="results-title">Scanning...</h3>
                </div>
                <div id="scan-results-content">
                    <div class="scan-progress-area">
                        <div class="scan-progress-spinner"></div>
                        <div class="scan-progress-text" id="scan-status-text">Starting scan...</div>
                        <div class="progress-bar-container mt-10">
                            <div class="progress-bar-fill" id="scan-progress-bar" style="width: 0%"></div>
                        </div>
                    </div>
                </div>
            `;
            scanButtons.after(progressCard);
        }
    } else {
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

function approveAllActions() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Approve All Actions';
    modalBody.innerHTML = `
        <p>Approve and execute all pending actions?</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-success" onclick="confirmApproveAllActions()">Approve All</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmApproveAllActions() {
    closeModal();

    try {
        const result = await api('/actions/approve-all', { method: 'POST' });
        showToast(`${result.success} actions completed, ${result.failed} failed`, result.failed > 0 ? 'warning' : 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
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

// ── Card-level Collapse ──

function toggleScanCard(cardId, prefKey) {
    const card = document.getElementById(cardId);
    if (!card) return;
    const body = card.querySelector('.card-body-collapsible');
    const chevron = card.querySelector('.card-collapse-chevron');
    if (!body) return;

    const isOpen = body.classList.contains('open');
    body.classList.toggle('open', !isOpen);
    card.classList.toggle('card-collapsed', isOpen);
    if (chevron) chevron.src = isOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    setUiPref(prefKey, isOpen);
}

// ── Metadata Updates (Rename) — Collapse State Management ──

function getRenameGroupCollapseState(showId) {
    const states = getUiPref('renameGroupCollapseStates', {});
    return states[showId] === true;
}

function setRenameGroupCollapseState(showId, collapsed) {
    const states = getUiPref('renameGroupCollapseStates', {});
    if (collapsed) {
        states[showId] = true;
    } else {
        delete states[showId];
    }
    setUiPref('renameGroupCollapseStates', states);
}

function toggleRenameShowGroup(header, showId) {
    const wrapper = header.nextElementSibling;
    const chevron = header.querySelector('.rename-show-chevron');

    if (wrapper.classList.contains('open')) {
        wrapper.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        setRenameGroupCollapseState(showId, true);
    } else {
        wrapper.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        setRenameGroupCollapseState(showId, false);
    }
}

function toggleAllRenameGroups(expand) {
    document.querySelectorAll('.rename-show-group').forEach(group => {
        const showId = group.dataset.showId;
        const wrapper = group.querySelector('.rename-episodes-table-wrapper');
        const chevron = group.querySelector('.rename-show-chevron');

        if (expand) {
            wrapper.classList.add('open');
            if (chevron) chevron.src = '/static/images/show-collapse.png';
            setRenameGroupCollapseState(showId, false);
        } else {
            wrapper.classList.remove('open');
            if (chevron) chevron.src = '/static/images/show-expand.png';
            setRenameGroupCollapseState(showId, true);
        }
    });
}

function toggleAllRenamesInShow(headerCheckbox, showId) {
    const checkboxes = document.querySelectorAll(`.rename-checkbox[data-show-id="${showId}"]`);
    checkboxes.forEach(cb => cb.checked = headerCheckbox.checked);
    updateRenameSelectionCount();
}

// ── Checkbox State Persistence ──

function saveRenameCheckboxState() {
    const state = {};
    document.querySelectorAll('.rename-checkbox').forEach(cb => {
        state[cb.dataset.renameIndex] = cb.checked;
    });
    setUiPref('renameCheckboxState', state);
}

function saveEpisodeCheckboxState() {
    const state = {};
    document.querySelectorAll('.episode-checkbox').forEach(cb => {
        state[cb.dataset.episodeId] = cb.checked;
    });
    setUiPref('missingCheckboxState', state);
}

function clearScanCheckboxStates() {
    setUiPref('renameCheckboxState', null);
    setUiPref('missingCheckboxState', null);
}

function updateRenameSelectionCount() {
    const checked = document.querySelectorAll('.rename-checkbox:checked');
    const total = document.querySelectorAll('.rename-checkbox');
    const countEl = document.getElementById('rename-selected-count');
    const applyBtn = document.getElementById('btn-apply-renames');

    // Sync show-level select-all checkboxes
    document.querySelectorAll('.rename-show-select-all').forEach(selectAll => {
        const group = selectAll.closest('.rename-show-group');
        if (!group) return;
        const allCbs = group.querySelectorAll('.rename-checkbox');
        const checkedCbs = group.querySelectorAll('.rename-checkbox:checked');
        selectAll.checked = allCbs.length > 0 && allCbs.length === checkedCbs.length;
    });

    if (countEl) {
        countEl.textContent = `${checked.length} of ${total.length} selected`;
    }
    if (applyBtn) {
        applyBtn.disabled = checked.length === 0;
    }
    saveRenameCheckboxState();
}

function applySelectedRenames() {
    const indices = [];
    document.querySelectorAll('.rename-checkbox:checked').forEach(cb => {
        indices.push(parseInt(cb.dataset.renameIndex));
    });
    if (indices.length === 0) { showToast('No renames selected', 'warning'); return; }

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Apply Renames';
    modalBody.innerHTML = `
        <p>Apply <strong>${indices.length}</strong> file rename${indices.length > 1 ? 's' : ''}?</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="confirmApplyRenames()">Apply Renames</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmApplyRenames() {
    const indices = [];
    document.querySelectorAll('.rename-checkbox:checked').forEach(cb => {
        indices.push(parseInt(cb.dataset.renameIndex));
    });

    closeModal();

    try {
        const result = await api('/scan/apply-renames', {
            method: 'POST',
            body: JSON.stringify({ rename_indices: indices })
        });
        showToast(`${result.success} renamed, ${result.failed} failed`, result.failed > 0 ? 'warning' : 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

// ── Missing Episodes — Collapse State Management ──

function getMissingGroupCollapseState(showId) {
    const states = getUiPref('missingGroupCollapseStates', {});
    return states[showId] === true;
}

function setMissingGroupCollapseState(showId, collapsed) {
    const states = getUiPref('missingGroupCollapseStates', {});
    if (collapsed) {
        states[showId] = true;
    } else {
        delete states[showId];
    }
    setUiPref('missingGroupCollapseStates', states);
}

// Missing Episodes - Season Collapse State Management
function getMissingSeasonCollapseState(seasonKey) {
    const states = getUiPref('missingSeasonCollapseStates', {});
    return states[seasonKey] === true;
}

function setMissingSeasonCollapseState(seasonKey, collapsed) {
    const states = getUiPref('missingSeasonCollapseStates', {});
    if (collapsed) {
        states[seasonKey] = true;
    } else {
        delete states[seasonKey];
    }
    setUiPref('missingSeasonCollapseStates', states);
}

function toggleMissingSeason(seasonKey, headerRow) {
    const rows = document.querySelectorAll(`.missing-episode-row[data-season-key="${seasonKey}"]`);
    const chevron = headerRow.querySelector('.missing-season-chevron');
    const isHidden = rows.length > 0 && rows[0].classList.contains('missing-season-hidden');

    rows.forEach(row => {
        row.classList.toggle('missing-season-hidden', !isHidden);
    });
    if (chevron) {
        chevron.src = isHidden ? '/static/images/show-collapse.png' : '/static/images/show-expand.png';
    }
    setMissingSeasonCollapseState(seasonKey, !isHidden);
}

function toggleMissingShowGroup(header, showId) {
    const wrapper = header.nextElementSibling;
    const chevron = header.querySelector('.missing-show-chevron');

    if (wrapper.classList.contains('open')) {
        wrapper.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        setMissingGroupCollapseState(showId, true);
    } else {
        wrapper.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
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
            if (chevron) chevron.src = '/static/images/show-collapse.png';
            setMissingGroupCollapseState(showId, false);
        } else {
            wrapper.classList.remove('open');
            if (chevron) chevron.src = '/static/images/show-expand.png';
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
    const importable = selected.filter(s => s.downloadIndex !== null);
    const countEl = document.getElementById('missing-selected-count');
    const fixMatchBtn = document.getElementById('btn-fix-match');
    const ignoreBtn = document.getElementById('btn-ignore');
    const importBtn = document.getElementById('btn-import-downloads');

    // Sync show-level select-all checkboxes
    document.querySelectorAll('.missing-show-select-all').forEach(selectAll => {
        const group = selectAll.closest('.missing-show-group');
        if (!group) return;
        const showId = group.dataset.showId;
        const allCbs = group.querySelectorAll('.episode-checkbox');
        const checkedCbs = group.querySelectorAll('.episode-checkbox:checked');
        selectAll.checked = allCbs.length > 0 && allCbs.length === checkedCbs.length;
    });

    if (countEl) {
        let text = `${selected.length} selected`;
        if (importable.length > 0) {
            text += ` (${importable.length} importable)`;
        }
        countEl.textContent = text;
    }
    if (fixMatchBtn) fixMatchBtn.disabled = selected.length === 0;
    if (ignoreBtn) ignoreBtn.disabled = selected.length === 0;
    if (importBtn) importBtn.disabled = importable.length === 0;
    saveEpisodeCheckboxState();
}

function getSelectedMissingEpisodes() {
    const selected = [];
    document.querySelectorAll('.episode-checkbox:checked').forEach(cb => {
        selected.push({
            showId: parseInt(cb.dataset.showId),
            episodeId: parseInt(cb.dataset.episodeId),
            showName: cb.dataset.showName,
            downloadIndex: cb.dataset.downloadIndex != null ? parseInt(cb.dataset.downloadIndex) : null,
        });
    });
    return selected;
}

// ── Import Downloads ──

function importCheckedDownloads() {
    const indices = [];
    document.querySelectorAll('.episode-checkbox:checked[data-download-index]').forEach(cb => {
        indices.push(parseInt(cb.dataset.downloadIndex));
    });
    if (indices.length === 0) { showToast('No importable episodes selected', 'warning'); return; }

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Import Episodes';
    modalBody.innerHTML = `
        <p>Import <strong>${indices.length}</strong> episode${indices.length > 1 ? 's' : ''} from downloads?</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-success" onclick="confirmImportDownloads()">Import Episodes</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmImportDownloads() {
    const indices = [];
    document.querySelectorAll('.episode-checkbox:checked[data-download-index]').forEach(cb => {
        indices.push(parseInt(cb.dataset.downloadIndex));
    });

    closeModal();

    try {
        const result = await api('/scan/import-downloads', {
            method: 'POST',
            body: JSON.stringify({ match_indices: indices })
        });
        showToast(`${result.success} imported, ${result.failed} failed`, result.failed > 0 ? 'warning' : 'success');
        renderScan();
    } catch (error) {
        // Error already shown
    }
}

// Scan Selected Items (episodes + shows)
async function scanSelectedItems(selectedEpisodes, selectedShowIds) {
    selectedEpisodes = selectedEpisodes || getSelectedMissingEpisodes();
    selectedShowIds = selectedShowIds || [];
    const totalCount = selectedEpisodes.length + selectedShowIds.length;

    if (totalCount === 0) {
        showToast('No items selected', 'warning');
        return;
    }

    // Show scanning modal
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Scanning Items';
    modalBody.innerHTML = `
        <div class="scanning-progress">
            <div class="scanning-spinner"></div>
            <p class="scanning-status">Scanning ${totalCount} item${totalCount > 1 ? 's' : ''}...</p>
            <p class="text-muted">Looking for matching files in show folders</p>
        </div>
    `;
    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');

    try {
        const result = await api('/scan/selected-episodes', {
            method: 'POST',
            body: JSON.stringify({
                episode_ids: selectedEpisodes.map(s => s.episodeId),
                show_ids: selectedShowIds
            })
        });

        // Show results
        const foundResults = result.results?.filter(r => r.status === 'found' || r.status === 'scanned') || [];
        const notFoundResults = result.results?.filter(r => r.status !== 'found' && r.status !== 'scanned') || [];

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
                                    <span class="scan-result-icon">&#10003;</span>
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
                                    <span class="scan-result-icon">&#10007;</span>
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
        const [tmdbResults, localShowsResp] = await Promise.all([
            api(`/shows/search/tmdb?q=${encodeURIComponent(query)}`),
            api('/shows')
        ]);
        const localShows = localShowsResp.shows;

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
                        <img src="${show.poster_path ? getImageUrl(show.poster_path) : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 60%22><rect fill=%22%23252542%22 width=%2240%22 height=%2260%22/></svg>'}" class="fix-match-poster">
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
                        <img src="${show.poster_path ? getImageUrl(show.poster_path) : 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 40 60%22><rect fill=%22%23252542%22 width=%2240%22 height=%2260%22/></svg>'}" class="fix-match-poster">
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

// ── Library Log Tab ─────────────────────────────────────────────

let libraryLogState = { entries: [], total: 0, dateFrom: '', dateTo: '', activeTags: [], searchQuery: '' };

async function renderLibraryLogTab() {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <div class="card-header" style="display: flex; align-items: center; justify-content: space-between;">
                <h3 class="card-title">Library Activity Log</h3>
                <div class="card-control-btns">
                    <button class="card-control-btn" onclick="llibCollapseAllYears()" title="Collapse all"><img src="/static/images/show-expand.png" alt="Collapse all"></button>
                    <button class="card-control-btn" onclick="llibExpandAllYears()" title="Expand all"><img src="/static/images/show-collapse.png" alt="Expand all"></button>
                </div>
            </div>
            <div class="watcher-log-controls">
                <label>From:</label>
                <input type="date" id="library-log-from" value="${libraryLogState.dateFrom}" onchange="onLibraryLogDateChange()">
                <label>To:</label>
                <input type="date" id="library-log-to" value="${libraryLogState.dateTo}" onchange="onLibraryLogDateChange()">
                <label>Search:</label>
                <input type="text" id="library-log-search" placeholder="Search..." value="${libraryLogState.searchQuery}" oninput="onLibraryLogSearchChange()">
                <button class="btn btn-sm btn-secondary" onclick="clearLibraryLogFilters()">Clear Filters</button>
                <button class="btn btn-sm btn-danger" onclick="confirmClearAllLibLogs()" style="margin-left: auto;">Clear All Logs</button>
            </div>
            <div class="log-tag-filters" id="library-log-tags">
                ${[
                    { type: 'rename', label: 'Rename' },
                    { type: 'import', label: 'Import' },
                    { type: 'rename_failed', label: 'Rename Failed' },
                    { type: 'import_failed', label: 'Import Failed' },
                ].map(t => `<button class="log-filter-tag action-${t.type}${libraryLogState.activeTags.includes(t.type) ? ' active' : ''}" onclick="toggleLibraryLogTag('${t.type}')">${t.label}</button>`).join('')}
            </div>
            <div id="library-log-content">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    `;

    await loadLibraryLog();
}

async function loadLibraryLog() {
    const content = document.getElementById('library-log-content');
    if (!content) return;

    try {
        let url = `/scan/library-log`;
        const params = [];
        if (libraryLogState.dateFrom) params.push(`date_from=${libraryLogState.dateFrom}`);
        if (libraryLogState.dateTo) params.push(`date_to=${libraryLogState.dateTo}T23:59:59`);
        if (params.length) url += '?' + params.join('&');

        const data = await api(url);
        libraryLogState.entries = data.entries || [];
        libraryLogState.total = data.total || 0;

        renderLibraryLogEntries();
    } catch (e) {
        content.innerHTML = '<div class="alert alert-danger">Failed to load library log.</div>';
    }
}

function getLibraryLogManualState() {
    return getUiPref('libraryLogManualState', {});
}

function setLibraryLogManualState(key, expanded) {
    const states = getLibraryLogManualState();
    states[key] = expanded;
    setUiPref('libraryLogManualState', states);
}

function isLibNodeExpanded(key, defaultExpanded) {
    const manual = getLibraryLogManualState();
    if (key in manual) return manual[key];
    return defaultExpanded;
}

function toggleLibraryLogNode(key, headerEl) {
    const contentEl = headerEl.nextElementSibling;
    const chevron = headerEl.querySelector('.wlog-chevron');
    if (!contentEl) return;
    const isOpen = contentEl.classList.contains('open');
    contentEl.classList.toggle('open', !isOpen);
    if (chevron) chevron.src = isOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    setLibraryLogManualState(key, !isOpen);
}

function _llibSetAll(headerClass, contentClass, expanded) {
    document.querySelectorAll(`#library-log-content .${headerClass}`).forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.toggle('open', expanded);
        if (chevron) chevron.src = expanded ? '/static/images/show-collapse.png' : '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], expanded);
    });
}

function llibCollapseAllYears() {
    _llibSetAll('wlog-year-header', 'wlog-year-content', false);
    _llibSetAll('wlog-month-header', 'wlog-month-content', false);
    _llibSetAll('wlog-day-header', 'wlog-day-content', false);
}
function llibExpandAllYears() {
    _llibSetAll('wlog-year-header', 'wlog-year-content', true);
    _llibSetAll('wlog-month-header', 'wlog-month-content', true);
    _llibSetAll('wlog-day-header', 'wlog-day-content', true);
}

function llibCollapseAllMonths(year) {
    const container = document.getElementById('library-log-content');
    if (!container) return;
    const yearHeader = container.querySelector(`.wlog-year-header[onclick*="'${year}'"]`);
    if (!yearHeader) return;
    const yearContent = yearHeader.nextElementSibling;
    if (!yearContent) return;
    yearContent.querySelectorAll('.wlog-month-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], false);
    });
    yearContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], false);
    });
}

function llibExpandAllMonths(year) {
    const container = document.getElementById('library-log-content');
    if (!container) return;
    const yearHeader = container.querySelector(`.wlog-year-header[onclick*="'${year}'"]`);
    if (!yearHeader) return;
    const yearContent = yearHeader.nextElementSibling;
    if (!yearContent) return;
    yearContent.classList.add('open');
    const yearChevron = yearHeader.querySelector('.wlog-chevron');
    if (yearChevron) yearChevron.src = '/static/images/show-collapse.png';
    setLibraryLogManualState(year, true);
    yearContent.querySelectorAll('.wlog-month-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], true);
    });
    yearContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], true);
    });
}

function llibCollapseAllDays(monthKey) {
    const container = document.getElementById('library-log-content');
    if (!container) return;
    const monthHeader = container.querySelector(`.wlog-month-header[onclick*="'${monthKey}'"]`);
    if (!monthHeader) return;
    const monthContent = monthHeader.nextElementSibling;
    if (!monthContent) return;
    monthContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], false);
    });
}

function llibExpandAllDays(monthKey) {
    const container = document.getElementById('library-log-content');
    if (!container) return;
    const monthHeader = container.querySelector(`.wlog-month-header[onclick*="'${monthKey}'"]`);
    if (!monthHeader) return;
    const monthContent = monthHeader.nextElementSibling;
    if (!monthContent) return;
    monthContent.classList.add('open');
    const monthChevron = monthHeader.querySelector('.wlog-chevron');
    if (monthChevron) monthChevron.src = '/static/images/show-collapse.png';
    setLibraryLogManualState(monthKey, true);
    monthContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleLibraryLogNode\('([^']+)'/);
        if (match) setLibraryLogManualState(match[1], true);
    });
}

function renderLibraryLogEntries() {
    const content = document.getElementById('library-log-content');
    if (!content) return;

    // Apply client-side filters (tags + search) on top of server-side date filtering
    let entries = libraryLogState.entries;
    const hasFilters = libraryLogState.activeTags.length > 0 || libraryLogState.searchQuery;

    if (libraryLogState.activeTags.length > 0) {
        entries = entries.filter(e => libraryLogState.activeTags.includes(e.action_type));
    }
    if (libraryLogState.searchQuery) {
        const q = libraryLogState.searchQuery.toLowerCase();
        entries = entries.filter(e => buildLibLogSummary(e).toLowerCase().includes(q));
    }

    if (!entries.length) {
        content.innerHTML = `
            <div class="watcher-log-empty">
                <p>No log entries${hasFilters || libraryLogState.dateFrom || libraryLogState.dateTo ? ' matching the current filters' : ' yet'}.</p>
            </div>
        `;
        return;
    }

    // Build hierarchy: year > month > day > entries
    const hierarchy = {};
    for (const entry of entries) {
        const date = entry.timestamp ? entry.timestamp.split('T')[0] : 'Unknown';
        const parts = date.split('-');
        if (parts.length < 3) continue;
        const year = parts[0], month = parts[1], day = parts[2];
        if (!hierarchy[year]) hierarchy[year] = {};
        if (!hierarchy[year][month]) hierarchy[year][month] = {};
        if (!hierarchy[year][month][day]) hierarchy[year][month][day] = [];
        hierarchy[year][month][day].push(entry);
    }

    const now = new Date();
    const tz = getConfiguredTimezone();
    let currentYear, currentMonth, currentDay;
    try {
        const parts = now.toLocaleDateString('en-CA', { timeZone: tz }).split('-');
        currentYear = parts[0];
        currentMonth = parts[1];
        currentDay = parts[2];
    } catch {
        currentYear = String(now.getFullYear());
        currentMonth = String(now.getMonth() + 1).padStart(2, '0');
        currentDay = String(now.getDate()).padStart(2, '0');
    }

    const monthNames = ['', 'January', 'February', 'March', 'April', 'May', 'June',
                         'July', 'August', 'September', 'October', 'November', 'December'];

    const activeKeys = [];
    let html = '';
    const yearKeys = Object.keys(hierarchy).sort((a, b) => b - a);

    for (const year of yearKeys) {
        const yearKey = 'llib-' + year;
        activeKeys.push(yearKey);
        const yearDefault = (year === currentYear);
        const yearExpanded = isLibNodeExpanded(yearKey, yearDefault);

        let yearCount = 0;
        for (const m of Object.keys(hierarchy[year])) {
            for (const d of Object.keys(hierarchy[year][m])) {
                yearCount += hierarchy[year][m][d].length;
            }
        }

        html += `<div class="wlog-year-group">`;
        html += `<div class="wlog-year-header" onclick="toggleLibraryLogNode('${yearKey}', this)">
            <img src="/static/images/${yearExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
            <span class="wlog-year-label">${year}</span>
            <span class="wlog-node-count">(${yearCount})</span>
            <span class="wlog-header-actions" onclick="event.stopPropagation()">
                <img src="/static/images/show-expand.png" class="wlog-action-btn" onclick="llibCollapseAllMonths('${yearKey}')" title="Collapse months" alt="Collapse">
                <img src="/static/images/show-collapse.png" class="wlog-action-btn" onclick="llibExpandAllMonths('${yearKey}')" title="Expand months" alt="Expand">
                <img src="/static/images/trash.png" class="wlog-delete-btn" onclick="deleteLibraryLogRange('${year}', '${year}-01-01T00:00:00', '${year}-12-31T23:59:59', ${yearCount})" title="Delete year" alt="Delete">
            </span>
        </div>`;
        html += `<div class="wlog-year-content ${yearExpanded ? 'open' : ''}">`;

        const monthKeys = Object.keys(hierarchy[year]).sort((a, b) => b - a);
        for (const month of monthKeys) {
            const monthKey = 'llib-' + year + '-' + month;
            activeKeys.push(monthKey);
            const monthDefault = (year === currentYear && month === currentMonth);
            const monthExpanded = isLibNodeExpanded(monthKey, monthDefault);

            let monthCount = 0;
            for (const d of Object.keys(hierarchy[year][month])) {
                monthCount += hierarchy[year][month][d].length;
            }

            const monthNum = parseInt(month, 10);
            const monthLabel = monthNames[monthNum] || month;
            const lastDayOfMonth = new Date(parseInt(year), parseInt(month), 0).getDate();

            html += `<div class="wlog-month-header" onclick="toggleLibraryLogNode('${monthKey}', this)">
                <img src="/static/images/${monthExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
                <span class="wlog-month-label">${monthLabel}</span>
                <span class="wlog-node-count">(${monthCount})</span>
                <span class="wlog-header-actions" onclick="event.stopPropagation()">
                    <img src="/static/images/show-expand.png" class="wlog-action-btn" onclick="llibCollapseAllDays('${monthKey}')" title="Collapse days" alt="Collapse">
                    <img src="/static/images/show-collapse.png" class="wlog-action-btn" onclick="llibExpandAllDays('${monthKey}')" title="Expand days" alt="Expand">
                    <img src="/static/images/trash.png" class="wlog-delete-btn" onclick="deleteLibraryLogRange('${monthLabel} ${year}', '${year}-${month}-01T00:00:00', '${year}-${month}-${String(lastDayOfMonth).padStart(2,'0')}T23:59:59', ${monthCount})" title="Delete month" alt="Delete">
                </span>
            </div>`;
            html += `<div class="wlog-month-content ${monthExpanded ? 'open' : ''}">`;

            const dayKeys = Object.keys(hierarchy[year][month]).sort((a, b) => b - a);
            for (const day of dayKeys) {
                const dayKey = 'llib-' + year + '-' + month + '-' + day;
                activeKeys.push(dayKey);
                const dayDefault = (year === currentYear && month === currentMonth && day === currentDay);
                const dayExpanded = isLibNodeExpanded(dayKey, dayDefault);
                const dayEntries = hierarchy[year][month][day];
                const dateStr = year + '-' + month + '-' + day;

                const displayDate = formatLogDate(dateStr);

                html += `<div class="wlog-day-header" onclick="toggleLibraryLogNode('${dayKey}', this)">
                    <img src="/static/images/${dayExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
                    <span class="wlog-day-label">${escapeHtml(displayDate)}</span>
                    <span class="wlog-node-count">(${dayEntries.length})</span>
                    <span class="wlog-header-actions" onclick="event.stopPropagation()">
                        <img src="/static/images/trash.png" class="wlog-delete-btn" onclick="deleteLibraryLogRange('${escapeHtml(displayDate)}', '${dateStr}T00:00:00', '${dateStr}T23:59:59', ${dayEntries.length})" title="Delete day" alt="Delete">
                    </span>
                </div>`;
                html += `<div class="wlog-day-content ${dayExpanded ? 'open' : ''}">`;

                for (const entry of dayEntries) {
                    const time = entry.timestamp ? formatLogTime(entry.timestamp) : '';
                    const actionLabel = formatLibActionType(entry.action_type);
                    const summary = buildLibLogSummary(entry);
                    const resultClass = entry.result ? 'result-' + entry.result : '';
                    const entryId = 'llib-detail-' + entry.id;

                    html += `
                        <div class="watcher-log-entry" onclick="toggleLogDetail('${entryId}')">
                            <span class="log-entry-time">${time}</span>
                            <span class="log-entry-badge action-${escapeHtml(entry.action_type || '')}">${escapeHtml(actionLabel)}</span>
                            <span class="log-entry-summary">${escapeHtml(summary)}</span>
                            <span class="log-entry-result ${resultClass}">${escapeHtml(entry.result || '')}</span>
                            <img src="/static/images/trash.png" class="wlog-delete-btn wlog-entry-delete" onclick="event.stopPropagation(); deleteLibraryLogEntry(${entry.id}, '${escapeHtml(summary).replace(/'/g, "\\'")}')" title="Delete entry" alt="Delete">
                        </div>
                        <div class="log-entry-details" id="${entryId}">
                            ${buildLibLogDetails(entry)}
                        </div>
                    `;
                }

                html += `</div>`; // day-content
            }

            html += `</div>`; // month-content
        }

        html += `</div>`; // year-content
        html += `</div>`; // year-group
    }

    if (libraryLogState.total > 0) {
        html += `<div class="watcher-log-pagination"><span class="page-info">${libraryLogState.total} entries</span></div>`;
    }

    content.innerHTML = html;
}

function formatLibActionType(action) {
    const labels = {
        'rename': 'Rename',
        'import': 'Import',
        'rename_failed': 'Rename Failed',
        'import_failed': 'Import Failed',
    };
    return labels[action] || action || 'Unknown';
}

function buildLibLogSummary(entry) {
    if (entry.show_name && entry.episode_code) {
        return `${entry.show_name} ${entry.episode_code}`;
    }
    if (entry.show_name) {
        return entry.show_name;
    }
    if (entry.file_path) {
        const parts = entry.file_path.split('/');
        return parts[parts.length - 1] || entry.file_path;
    }
    if (entry.details) {
        return entry.details.substring(0, 80);
    }
    return entry.action_type || '';
}

function buildLibLogDetails(entry) {
    let html = '';
    if (entry.details) {
        html += `<div class="detail-row"><span class="detail-label">Details</span><span class="detail-value">${escapeHtml(entry.details)}</span></div>`;
    }
    if (entry.file_path) {
        html += `<div class="detail-row"><span class="detail-label">Source</span><span class="detail-value">${escapeHtml(entry.file_path)}</span></div>`;
    }
    if (entry.dest_path) {
        html += `<div class="detail-row"><span class="detail-label">Destination</span><span class="detail-value">${escapeHtml(entry.dest_path)}</span></div>`;
    }
    if (entry.show_name) {
        html += `<div class="detail-row"><span class="detail-label">Show</span><span class="detail-value">${escapeHtml(entry.show_name)}</span></div>`;
    }
    if (entry.episode_code) {
        html += `<div class="detail-row"><span class="detail-label">Episode</span><span class="detail-value">${escapeHtml(entry.episode_code)}</span></div>`;
    }
    if (entry.timestamp) {
        html += `<div class="detail-row"><span class="detail-label">Time</span><span class="detail-value">${escapeHtml(entry.timestamp)}</span></div>`;
    }
    return html || '<em>No additional details</em>';
}

function onLibraryLogDateChange() {
    libraryLogState.dateFrom = document.getElementById('library-log-from')?.value || '';
    libraryLogState.dateTo = document.getElementById('library-log-to')?.value || '';
    loadLibraryLog();
}

function onLibraryLogSearchChange() {
    libraryLogState.searchQuery = document.getElementById('library-log-search')?.value || '';
    renderLibraryLogEntries();
}

function toggleLibraryLogTag(actionType) {
    const idx = libraryLogState.activeTags.indexOf(actionType);
    if (idx >= 0) {
        libraryLogState.activeTags.splice(idx, 1);
    } else {
        libraryLogState.activeTags.push(actionType);
    }
    // Update button active states
    document.querySelectorAll('#library-log-tags .log-filter-tag').forEach(btn => {
        const type = btn.className.match(/action-(\S+)/)?.[1];
        if (type) btn.classList.toggle('active', libraryLogState.activeTags.includes(type));
    });
    renderLibraryLogEntries();
}

function clearLibraryLogFilters() {
    libraryLogState.dateFrom = '';
    libraryLogState.dateTo = '';
    libraryLogState.activeTags = [];
    libraryLogState.searchQuery = '';
    const fromEl = document.getElementById('library-log-from');
    const toEl = document.getElementById('library-log-to');
    const searchEl = document.getElementById('library-log-search');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    if (searchEl) searchEl.value = '';
    document.querySelectorAll('#library-log-tags .log-filter-tag').forEach(btn => btn.classList.remove('active'));
    loadLibraryLog();
}

function confirmClearAllLibLogs() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Clear All Library Logs';
    modalBody.innerHTML = `
        <p>Are you sure you want to delete <strong>all</strong> library log entries?</p>
        <p class="text-muted">This action cannot be undone.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="clearAllLibLogs()">Delete All Logs</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function clearAllLibLogs() {
    closeModal();
    try {
        const result = await api('/scan/library-log', { method: 'DELETE' });
        showToast(result.message, 'success');
        await loadLibraryLog();
    } catch (error) {
        // Error already shown
    }
}

function deleteLibraryLogEntry(entryId, summary) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Delete Log Entry';
    modalBody.innerHTML = `
        <p>Delete this log entry?</p>
        <p class="text-muted" style="word-break: break-all;">${escapeHtml(summary)}</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="confirmDeleteLibEntry(${entryId})">Delete</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmDeleteLibEntry(entryId) {
    closeModal();
    try {
        const result = await api(`/scan/library-log/${entryId}`, { method: 'DELETE' });
        showToast(result.message, 'success');
        await loadLibraryLog();
    } catch (error) {
        // Error already shown
    }
}

function deleteLibraryLogRange(label, start, end, count) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Delete Log Entries';
    modalBody.innerHTML = `
        <p>Delete all <strong>${count}</strong> log ${count === 1 ? 'entry' : 'entries'} for <strong>${escapeHtml(label)}</strong>?</p>
        <p class="text-muted">This action cannot be undone.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="confirmDeleteLibRange('${start}', '${end}')">Delete ${count} ${count === 1 ? 'Entry' : 'Entries'}</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmDeleteLibRange(start, end) {
    closeModal();
    try {
        const result = await api(`/scan/library-log/range/${encodeURIComponent(start)}/${encodeURIComponent(end)}`, { method: 'DELETE' });
        showToast(result.message, 'success');
        await loadLibraryLog();
    } catch (error) {
        // Error already shown
    }
}

// ── Movie Scan Operations ──

async function triggerMovieLibraryScan() {
    const btn = document.getElementById('scan-movies-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Scanning...'; }

    try {
        await api('/scan/movies', { method: 'POST' });
        showToast('Movie library scan started', 'info');
        pollMovieScanStatus();
    } catch (error) {
        if (btn) { btn.disabled = false; btn.textContent = 'Scan Movie Library'; }
    }
}

function pollMovieScanStatus() {
    const checkStatus = async () => {
        try {
            const status = await fetch(`${API_BASE}/scan/movies/status`).then(r => r.json());
            if (status.running) {
                setTimeout(checkStatus, 1000);
            } else {
                if (status.result?.error) {
                    showToast(`Movie scan failed: ${status.result.error}`, 'error');
                } else {
                    const r = status.result || {};
                    showToast(`Movie scan complete: ${r.matched || 0} matched, ${r.unmatched || 0} unmatched`, 'success');
                }
                renderScan();
            }
        } catch (error) {
            setTimeout(checkStatus, 2000);
        }
    };
    setTimeout(checkStatus, 500);
}

function showMovieDiscoveryModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Discover Movies from Folder';
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Movie Library Folder</label>
            <input type="text" id="movie-discover-folder" class="form-control" placeholder="/path/to/movies">
            <small class="text-muted">Enter a folder containing movie files to discover and add them.</small>
        </div>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-primary" onclick="startMovieDiscovery()">Start Discovery</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function startMovieDiscovery() {
    const folderPath = document.getElementById('movie-discover-folder')?.value.trim();
    if (!folderPath) {
        showToast('Please enter a folder path', 'warning');
        return;
    }

    closeModal();

    try {
        await api('/scan/movie-library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_path: folderPath })
        });
        showToast('Movie discovery started', 'info');
        pollMovieDiscoveryStatus();
    } catch (error) {
        // Error already shown
    }
}

function pollMovieDiscoveryStatus() {
    const checkStatus = async () => {
        try {
            const status = await fetch(`${API_BASE}/scan/movie-library-folder/status`).then(r => r.json());
            if (status.running) {
                setTimeout(checkStatus, 1000);
            } else {
                if (status.result?.error) {
                    showToast(`Discovery failed: ${status.result.error}`, 'error');
                } else {
                    const r = status.result || {};
                    showToast(`Discovery complete: ${r.movies_added || 0} added, ${r.movies_skipped || 0} skipped`, 'success');
                }
                renderScan();
            }
        } catch (error) {
            setTimeout(checkStatus, 2000);
        }
    };
    setTimeout(checkStatus, 500);
}

async function showMovieRenamePreviewsModal() {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Movie Rename Previews';
    modalBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
    modal.classList.add('active');
    modal.classList.add('modal-wide');

    try {
        const previews = await api('/scan/movie-rename-previews');

        if (!previews || previews.length === 0) {
            modalBody.innerHTML = `
                <p class="text-muted text-center" style="padding: 20px;">No movie renames pending. All movies have correct filenames.</p>
                <div class="modal-buttons">
                    <button class="btn btn-outline" onclick="closeModal()">Close</button>
                </div>
            `;
            return;
        }

        modalBody.innerHTML = `
            <div class="table-container" style="max-height: 400px; overflow-y: auto;">
                <table style="font-size: 0.85rem;">
                    <thead>
                        <tr>
                            <th><input type="checkbox" id="movie-rename-select-all" checked onchange="toggleAllMovieRenames(this.checked)"></th>
                            <th>Movie</th>
                            <th>Current</th>
                            <th></th>
                            <th>New</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${previews.map((p, i) => `
                            <tr>
                                <td><input type="checkbox" class="movie-rename-cb" data-index="${i}" checked></td>
                                <td>${escapeHtml(p.title || 'Unknown')}</td>
                                <td class="filename-cell"><div class="filename-line" title="${escapeHtml(p.current_filename || '')}">${escapeHtml(p.current_filename || '')}</div></td>
                                <td>&rarr;</td>
                                <td class="filename-cell"><div class="filename-line" title="${escapeHtml(p.new_filename || '')}">${escapeHtml(p.new_filename || '')}</div></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
            <div class="modal-buttons" style="margin-top: 15px;">
                <button class="btn btn-primary" onclick="applySelectedMovieRenames()">Apply Selected Renames</button>
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>
        `;
    } catch (error) {
        modalBody.innerHTML = `
            <p class="text-muted text-center">Failed to load rename previews.</p>
            <div class="modal-buttons">
                <button class="btn btn-outline" onclick="closeModal()">Close</button>
            </div>
        `;
    }
}

function toggleAllMovieRenames(checked) {
    document.querySelectorAll('.movie-rename-cb').forEach(cb => cb.checked = checked);
}

async function applySelectedMovieRenames() {
    const indices = [];
    document.querySelectorAll('.movie-rename-cb:checked').forEach(cb => {
        indices.push(parseInt(cb.dataset.index));
    });

    if (indices.length === 0) {
        showToast('No renames selected', 'warning');
        return;
    }

    closeModal();

    try {
        const result = await api('/scan/apply-movie-renames', {
            method: 'POST',
            body: JSON.stringify({ rename_indices: indices })
        });
        showToast(`${result.success || 0} renamed, ${result.failed || 0} failed`, result.failed > 0 ? 'warning' : 'success');
    } catch (error) {
        // Error already shown
    }
}

// ── Ignored Episodes Tab ─────────────────────────────────────────

let _ignoredEpisodeData = {};

async function renderIgnoredTab() {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;
    container.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const episodes = await api('/scan/ignored-episodes');
        if (!episodes || episodes.length === 0) {
            container.innerHTML = `
                <div class="card mb-20">
                    <div class="card-body" style="text-align: center; padding: 40px; color: var(--text-secondary);">
                        No ignored episodes
                    </div>
                </div>
            `;
            return;
        }
        container.innerHTML = `<div class="card">${renderIgnoredGrouped(episodes)}</div>`;
    } catch (error) {
        container.innerHTML = `<div class="alert alert-danger">Failed to load ignored episodes.</div>`;
    }
}

function renderIgnoredGrouped(episodes) {
    _ignoredEpisodeData = {};

    // Group by show
    const showGroups = {};
    episodes.forEach(ep => {
        if (!showGroups[ep.show_id]) {
            showGroups[ep.show_id] = {
                show_id: ep.show_id,
                show_name: ep.show_name,
                episodes: []
            };
        }
        showGroups[ep.show_id].episodes.push(ep);
    });

    const shows = Object.values(showGroups).sort((a, b) => a.show_name.localeCompare(b.show_name));
    const showPrefKey = 'ignoredTabCollapseStates';
    const seasonPrefKey = 'ignoredTabSeasonStates';

    let html = '<div class="missing-episodes-grouped">';

    shows.forEach(show => {
        const collapseStates = getUiPref(showPrefKey, {});
        const isCollapsed = collapseStates[show.show_id] === true;

        html += `<div class="missing-show-group" data-show-id="${show.show_id}">`;

        // Show header
        html += `
            <div class="missing-show-header" onclick="toggleIgnoredShowGroup(this, ${show.show_id})">
                <img src="/static/images/${isCollapsed ? 'show-expand' : 'show-collapse'}.png" class="missing-show-chevron" alt="">
                <span class="missing-show-name">${escapeHtml(show.show_name)}</span>
                <span class="missing-show-count">(${show.episodes.length} ${show.episodes.length === 1 ? 'episode' : 'episodes'})</span>
                <img src="/static/images/goto.png" class="missing-show-goto" onclick="event.stopPropagation(); showShowDetail(${show.show_id})" alt="Go to show">
            </div>
        `;

        // Show content wrapper
        html += `<div class="missing-episodes-table-wrapper ${isCollapsed ? '' : 'open'}">`;

        // Group by season
        const seasonGroups = {};
        show.episodes.forEach(ep => {
            const s = ep.season;
            if (!seasonGroups[s]) seasonGroups[s] = [];
            seasonGroups[s].push(ep);
        });
        const seasonKeys = Object.keys(seasonGroups).sort((a, b) => a - b);

        seasonKeys.forEach(seasonNum => {
            const eps = seasonGroups[seasonNum];
            const seasonKey = `ignored-${show.show_id}-${seasonNum}`;
            const seasonStates = getUiPref(seasonPrefKey, {});
            const seasonCollapsed = seasonStates[seasonKey] === true;

            // Season header
            html += `
                <div class="wlog-day-header" onclick="toggleIgnoredSeasonNode('${seasonKey}', this)">
                    <img src="/static/images/${seasonCollapsed ? 'show-expand' : 'show-collapse'}.png" class="wlog-chevron" alt="">
                    <span class="wlog-day-label">Season ${seasonNum}</span>
                    <span class="wlog-node-count">(${eps.length})</span>
                </div>
            `;

            // Season content
            html += `<div class="wlog-day-content ${seasonCollapsed ? '' : 'open'}">`;

            eps.sort((a, b) => a.episode - b.episode);
            eps.forEach(ep => {
                const detailId = `ignored-detail-${ep.episode_id}`;
                const dateShort = ep.created_at ? ignoredFormatShortDate(ep.created_at) : '';

                // Store episode data for remove confirmation
                _ignoredEpisodeData[ep.episode_id] = {
                    show_name: show.show_name,
                    season: ep.season,
                    episode: ep.episode
                };

                // Episode entry row
                html += `
                    <div class="watcher-log-entry" onclick="toggleLogDetail('${detailId}')">
                        <span class="log-entry-time">${dateShort}</span>
                        <span class="log-entry-summary">E${String(ep.episode).padStart(2, '0')} \u2014 ${escapeHtml(ep.title) || 'Untitled'}</span>
                        <img src="/static/images/trash.png" class="wlog-delete-btn wlog-entry-delete"
                             onclick="event.stopPropagation(); confirmUnignoreEpisode(${ep.episode_id})"
                             title="Remove from ignored" alt="Remove">
                    </div>
                `;

                // Expandable detail panel
                html += `<div class="log-entry-details" id="${detailId}">`;
                if (ep.reason) {
                    html += `<div class="detail-row"><span class="detail-label">Reason</span><span class="detail-value">${escapeHtml(ep.reason)}</span></div>`;
                }
                if (ep.created_at) {
                    html += `<div class="detail-row"><span class="detail-label">Added</span><span class="detail-value">${ignoredFormatFullDate(ep.created_at)}</span></div>`;
                }
                html += `</div>`;
            });

            html += `</div>`; // close wlog-day-content
        });

        html += `</div></div>`; // close table-wrapper and show-group
    });

    html += '</div>';
    return html;
}

// Ignored tab collapse/expand

function toggleIgnoredShowGroup(header, showId) {
    const wrapper = header.nextElementSibling;
    const chevron = header.querySelector('.missing-show-chevron');
    const prefKey = 'ignoredTabCollapseStates';

    if (wrapper.classList.contains('open')) {
        wrapper.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        setIgnoredCollapseState(prefKey, showId, true);
    } else {
        wrapper.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        setIgnoredCollapseState(prefKey, showId, false);
    }
}

function setIgnoredCollapseState(prefKey, key, collapsed) {
    const states = getUiPref(prefKey, {});
    if (collapsed) {
        states[key] = true;
    } else {
        delete states[key];
    }
    setUiPref(prefKey, states);
}

function toggleIgnoredSeasonNode(key, headerEl) {
    const content = headerEl.nextElementSibling;
    const chevron = headerEl.querySelector('.wlog-chevron');
    const wasOpen = content.classList.contains('open');

    content.classList.toggle('open', !wasOpen);
    if (chevron) {
        chevron.src = wasOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    }

    setIgnoredCollapseState('ignoredTabSeasonStates', key, wasOpen);
}

// Ignored tab remove actions

function confirmUnignoreEpisode(episodeId) {
    const info = _ignoredEpisodeData[episodeId];
    const showName = info ? info.show_name : 'Unknown';
    const season = info ? info.season : 0;
    const episode = info ? info.episode : 0;

    document.getElementById('modal-title').textContent = 'Remove from Ignored';
    document.getElementById('modal-body').innerHTML = `
        <p>Remove <strong>${escapeHtml(showName)}</strong> S${String(season).padStart(2, '0')}E${String(episode).padStart(2, '0')} from the ignored list?</p>
        <p style="color: var(--text-secondary); font-size: 0.9em;">This episode will appear in Missing Episodes again on the next scan.</p>
        <div style="display: flex; gap: 10px; justify-content: flex-end; margin-top: 20px;">
            <button class="btn btn-sm" onclick="closeModal()">Cancel</button>
            <button class="btn btn-danger btn-sm" onclick="executeUnignoreEpisode(${episodeId})">Remove</button>
        </div>
    `;
    document.getElementById('modal').classList.add('active');
}

async function executeUnignoreEpisode(episodeId) {
    try {
        await api(`/scan/ignore-episodes/${episodeId}`, { method: 'DELETE' });
        closeModal();
        showToast('Episode removed from ignored list', 'success');
        await renderIgnoredTab();
    } catch (error) {
        showToast('Failed to remove episode', 'error');
    }
}

// Ignored tab date helpers

function ignoredFormatShortDate(isoString) {
    const d = new Date(isoString);
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    return `${months[d.getMonth()]} ${d.getDate()}`;
}

function ignoredFormatFullDate(isoString) {
    const d = new Date(isoString);
    return d.toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) +
        ' at ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}
