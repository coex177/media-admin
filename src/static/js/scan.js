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
                <button class="scan-tab ${activeScanTab === 'issues' ? 'active' : ''}" data-tab="issues" onclick="switchScanTab('issues')"><img src="/static/images/issues.png" class="tab-icon-img" alt="">Issues</button>
            </div>

            <div id="scan-tab-content"></div>
        `;

        if (activeScanTab === 'operations') {
            renderScanOperationsTab(actions, scanStatus, missingEpisodes, metadataUpdates, downloadMatches, settings);
        } else if (activeScanTab === 'issues') {
            renderIssuesTab();
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
    } else if (tab === 'issues') {
        renderIssuesTab();
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
                    <button class="btn btn-sm" onclick="markSelectedAsSpecials()" id="btn-specials" disabled>Specials</button>
                    <button class="card-control-btn" onclick="toggleAllMissingGroups(false)" title="Collapse all"><img src="/static/images/show-expand.png" alt="Collapse all"></button>
                    <button class="card-control-btn" onclick="toggleAllMissingGroups(true)" title="Expand all"><img src="/static/images/show-collapse.png" alt="Expand all"></button>
                </div>
            </div>
            <div class="card-body-collapsible ${cardCollapsed ? '' : 'open'}">
            <div class="missing-episodes-grouped">
                ${missingEpisodes.map(show => {
                    const isCollapsed = getMissingGroupCollapseState(show.show_id);
                    return `
                    <div class="missing-show-group" data-show-id="${show.show_id}">
                        <div class="missing-show-header" onclick="toggleMissingShowGroup(this, ${show.show_id})">
                            <img src="/static/images/${isCollapsed ? 'show-expand.png' : 'show-collapse.png'}" class="missing-show-chevron" alt="">
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
                                        <th class="missing-show-link-col"><img src="/static/images/goto.png" class="missing-show-goto" onclick="event.stopPropagation(); showShowDetail(${show.show_id})" title="Go to ${escapeHtml(show.show_name)}" alt="Go to show"></th>
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
                                                    '<td colspan="6" class="missing-season-header-cell">' +
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
                                                    '<td></td>' +
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
    const specialsBtn = document.getElementById('btn-specials');
    const importBtn = document.getElementById('btn-import-downloads');

    if (countEl) {
        let text = `${selected.length} selected`;
        if (importable.length > 0) {
            text += ` (${importable.length} importable)`;
        }
        countEl.textContent = text;
    }
    if (fixMatchBtn) fixMatchBtn.disabled = selected.length === 0;
    if (ignoreBtn) ignoreBtn.disabled = selected.length === 0;
    if (specialsBtn) specialsBtn.disabled = selected.length === 0;
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
