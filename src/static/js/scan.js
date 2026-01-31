/**
 * Media Admin - Scan (scan page, scan triggers, missing episodes, fix match)
 */

let activeScanTab = 'operations';

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

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Scan</h1>
            </div>

            <div class="scan-tabs">
                <button class="scan-tab ${activeScanTab === 'operations' ? 'active' : ''}" onclick="switchScanTab('operations')"><img src="/static/images/operations.png" class="tab-icon-img" alt="">Operations</button>
                <button class="scan-tab ${activeScanTab === 'watcher-log' ? 'active' : ''}" onclick="switchScanTab('watcher-log')"><img src="/static/images/watcher-log.png" class="tab-icon-img" alt="">Watcher Log</button>
            </div>

            <div id="scan-tab-content"></div>
        `;

        if (activeScanTab === 'operations') {
            renderScanOperationsTab(actions, scanStatus, missingEpisodes, settings);
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
        btn.classList.toggle('active', btn.textContent.trim().toLowerCase().replace(/\s+/g, '-') ===
            (tab === 'operations' ? 'operations' : 'watcher-log'));
    });

    const container = document.getElementById('scan-tab-content');
    if (!container) return;

    if (tab === 'operations') {
        // Re-render full scan page to get fresh data
        renderScan();
    } else {
        renderWatcherLogTab();
    }
}

function renderScanOperationsTab(actions, scanStatus, missingEpisodes, settings) {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;
    const displayEpFormat = settings?.display_episode_format || '{season}x{episode:02d}';

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
                                                <th class="missing-show-link-col"><span class="missing-show-link" onclick="event.stopPropagation(); showShowDetail(${show.show_id})">${escapeHtml(show.show_name)}</span></th>
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
                                                        rows += '<tr class="missing-episode-row' + (seasonCollapsed ? ' missing-season-hidden' : '') + '" data-season-key="' + seasonKey + '">' +
                                                            '<td class="checkbox-col"><input type="checkbox" class="episode-checkbox" data-show-id="' + show.show_id + '" data-episode-id="' + ep.id + '" data-show-name="' + escapeHtml(show.show_name) + '" onclick="event.stopPropagation(); updateMissingSelectionCount()"></td>' +
                                                            '<td>' + ep.season + '</td>' +
                                                            '<td>' + ep.episode + '</td>' +
                                                            '<td>' + (ep.air_date || '-') + '</td>' +
                                                            '<td class="filename-cell">' +
                                                            '<div class="filename-line" onclick="showShowDetail(' + show.show_id + ', ' + ep.season + ', ' + ep.episode + ')" title="' + escapeHtml(ep.expected_filename) + '">' + escapeHtml(ep.expected_filename) + '</div>' +
                                                            '<div class="folder-line" title="' + escapeHtml(ep.expected_folder) + '">' + escapeHtml(ep.expected_folder) + '</div>' +
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

// Missing Episodes - Collapse State Management
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
