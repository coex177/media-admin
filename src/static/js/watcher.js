/**
 * Media Admin - Watcher (settings tab, log tab, status dot, quality priorities)
 */

// ── Watcher Log state ─────────────────────────────────────────
let watcherLogState = { entries: [], total: 0, offset: 0, limit: 50, dateFrom: '', dateTo: '' };

// ── Media Watcher state ─────────────────────────────────────────
let watcherSettings = null;
let watcherStatus = null;

function renderSettingsWatcher() {
    // Return a loading shell; actual data loads async
    loadWatcherData();
    return `<div id="watcher-settings-container"><div class="loading"><div class="spinner"></div></div></div>`;
}

async function loadWatcherData() {
    try {
        const [settings, status] = await Promise.all([
            api('/watcher/settings'),
            api('/watcher/status'),
        ]);
        watcherSettings = settings;
        watcherStatus = status;
        const container = document.getElementById('watcher-settings-container');
        if (container) container.innerHTML = renderWatcherContent();
        initWatcherDragDrop();
    } catch (e) {
        const container = document.getElementById('watcher-settings-container');
        if (container) container.innerHTML = `<div class="card"><p class="text-muted">Failed to load watcher settings.</p></div>`;
    }
}

function renderWatcherContent() {
    const s = watcherSettings;
    const st = watcherStatus;
    const statusText = st.status.charAt(0).toUpperCase() + st.status.slice(1);
    const dotClass = st.status;
    const isRunning = st.status === 'running';
    const isStopped = st.status === 'stopped';

    const allPrereqsMet = st.all_prerequisites_met;

    // Quality factor labels
    const factorLabels = {
        resolution: 'Resolution',
        bitrate: 'Bitrate',
        video_codec: 'Video Codec',
        audio_codec: 'Audio Codec',
        audio_channels: 'Audio Channels',
        subtitles: 'Subtitles',
    };

    const pointValues = [100, 80, 60, 40, 20, 10];
    const priorities = s.watcher_quality_priorities || [];

    // All companion file types
    const allCompanionTypes = ['.srt', '.sub', '.ass', '.ssa', '.vtt', '.idx', '.sup', '.nfo', '.jpg', '.jpeg', '.png', '.tbn'];
    const selectedCompanions = s.watcher_companion_types || [];

    return `
        <!-- Status Bar -->
        <div class="watcher-status-bar">
            <div class="watcher-status-left">
                <span class="watcher-status-dot ${dotClass}"></span>
                <span class="watcher-status-label">${statusText}</span>
                ${isRunning && st.pending_files > 0 ? `<span class="watcher-status-detail">${st.pending_files} file(s) stabilizing</span>` : ''}
                ${isRunning && st.queued_files > 0 ? `<span class="watcher-status-detail">${st.queued_files} queued</span>` : ''}
            </div>
            <div class="watcher-status-actions">
                ${isStopped
                    ? `<button class="btn btn-sm btn-primary" onclick="startWatcher()" ${!allPrereqsMet ? 'disabled title="Prerequisites not met"' : ''}>Start Watcher</button>`
                    : `<button class="btn btn-sm btn-danger" onclick="stopWatcher()">Stop Watcher</button>`
                }
            </div>
        </div>

        <!-- Prerequisites -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Prerequisites</h2>
            <ul class="prerequisites-list">
                ${st.prerequisites.map(p => `
                    <li>
                        <span class="prereq-icon ${p.met ? 'met' : 'unmet'}">${p.met ? '&#10003;' : '&#10007;'}</span>
                        <span>${escapeHtml(p.name)}</span>
                        <span class="prereq-detail" title="${escapeHtml(p.detail)}">${escapeHtml(p.detail)}</span>
                    </li>
                `).join('')}
            </ul>
        </div>

        <!-- Issues Folder -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Issues Folder</h2>
            <p class="text-muted" style="margin-bottom:10px;">Files that can't be matched or resolved are moved here.</p>
            <div class="watcher-path-input">
                <input type="text" class="form-control" id="watcher-issues-folder"
                    value="${escapeHtml(s.watcher_issues_folder || '')}"
                    placeholder="/path/to/issues/folder"
                    onchange="autoSaveIssuesFolder()">
            </div>
        </div>

        <!-- Monitoring Settings -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Monitoring</h2>

            <div class="watcher-setting-row">
                <div class="watcher-setting-info">
                    <div class="watcher-setting-label">Monitor Subfolders</div>
                    <div class="watcher-setting-desc">Watch subdirectories inside download folders</div>
                </div>
                <div class="watcher-setting-control">
                    <label class="toggle-switch">
                        <input type="checkbox" id="watcher-monitor-subfolders" ${s.watcher_monitor_subfolders ? 'checked' : ''} onchange="autoSaveWatcherSettings()">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="watcher-setting-row">
                <div class="watcher-setting-info">
                    <div class="watcher-setting-label">Delete Empty Folders</div>
                    <div class="watcher-setting-desc">Remove empty directories after files are moved</div>
                </div>
                <div class="watcher-setting-control">
                    <label class="toggle-switch">
                        <input type="checkbox" id="watcher-delete-empty" ${s.watcher_delete_empty_folders ? 'checked' : ''} onchange="autoSaveWatcherSettings()">
                        <span class="toggle-slider"></span>
                    </label>
                </div>
            </div>

            <div class="watcher-setting-row">
                <div class="watcher-setting-info">
                    <div class="watcher-setting-label">Minimum File Size</div>
                    <div class="watcher-setting-desc">Files smaller than this are considered samples and skipped</div>
                </div>
                <div class="watcher-setting-control">
                    <input type="number" class="form-control form-control-sm" id="watcher-min-size" value="${s.watcher_min_file_size_mb}" min="0" step="10" onchange="autoSaveWatcherSettings()"> <span class="text-muted" style="font-size:0.85rem;">MB</span>
                </div>
            </div>

        </div>

        <!-- Issues Organization -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Issues Organization</h2>

            <div class="watcher-setting-row">
                <div class="watcher-setting-info">
                    <div class="watcher-setting-label">Organization Scheme</div>
                    <div class="watcher-setting-desc">How files in the Issues folder are organized</div>
                </div>
                <div class="watcher-setting-control">
                    <select id="watcher-issues-org" class="form-control form-control-sm" onchange="autoSaveWatcherSettings()">
                        <option value="date" ${s.watcher_issues_organization === 'date' ? 'selected' : ''}>By Date</option>
                        <option value="reason" ${s.watcher_issues_organization === 'reason' ? 'selected' : ''}>By Reason</option>
                        <option value="flat" ${s.watcher_issues_organization === 'flat' ? 'selected' : ''}>Flat</option>
                    </select>
                </div>
            </div>

            <div class="watcher-setting-row">
                <div class="watcher-setting-info">
                    <div class="watcher-setting-label">Auto-Purge</div>
                    <div class="watcher-setting-desc">Automatically delete old files in the Issues folder</div>
                </div>
                <div class="watcher-setting-control">
                    <select id="watcher-auto-purge" class="form-control form-control-sm" onchange="autoSaveWatcherSettings()">
                        <option value="0" ${s.watcher_auto_purge_days === 0 ? 'selected' : ''}>Off</option>
                        <option value="7" ${s.watcher_auto_purge_days === 7 ? 'selected' : ''}>7 days</option>
                        <option value="14" ${s.watcher_auto_purge_days === 14 ? 'selected' : ''}>14 days</option>
                        <option value="30" ${s.watcher_auto_purge_days === 30 ? 'selected' : ''}>30 days</option>
                        <option value="60" ${s.watcher_auto_purge_days === 60 ? 'selected' : ''}>60 days</option>
                        <option value="90" ${s.watcher_auto_purge_days === 90 ? 'selected' : ''}>90 days</option>
                    </select>
                </div>
            </div>
        </div>

        <!-- Companion File Types -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Companion File Types</h2>
            <p class="text-muted" style="margin-bottom:6px;">Select which companion files should be moved alongside video files.</p>
            <div class="companion-types-grid">
                ${allCompanionTypes.map(ext => `
                    <label class="companion-type-check">
                        <input type="checkbox" value="${ext}" ${selectedCompanions.includes(ext) ? 'checked' : ''} onchange="autoSaveWatcherSettings()">
                        ${ext}
                    </label>
                `).join('')}
            </div>
        </div>

        <!-- Quality Priorities -->
        <div class="card watcher-section">
            <h2 class="card-title mb-20">Quality Priorities</h2>
            <p class="text-muted" style="margin-bottom:10px;">Drag to reorder. When comparing files, factors are checked top-to-bottom; the first decisive difference wins.</p>
            <div class="quality-priorities-container">
                <div class="quality-priority-slots" id="quality-priority-list">
                    ${priorities.map((p, i) => `
                        <div class="quality-priority-slot" draggable="true" data-index="${i}" data-factor="${p.factor}">
                            <span class="priority-handle">&#9776;</span>
                            <span class="priority-rank">${pointValues[i]} pts</span>
                            <span class="priority-factor-name">${factorLabels[p.factor] || p.factor}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        </div>

    `;
}

async function autoSaveIssuesFolder() {
    const input = document.getElementById('watcher-issues-folder');
    if (!input) return;
    try {
        await api('/watcher/settings', {
            method: 'PUT',
            body: JSON.stringify({ watcher_issues_folder: input.value.trim() }),
        });
        showToast('Issues folder updated', 'success');
        loadWatcherData();
    } catch (e) {
        // error shown by api()
    }
}

async function autoSaveWatcherSettings() {
    const data = {};

    const monitorSubfolders = document.getElementById('watcher-monitor-subfolders');
    if (monitorSubfolders) data.watcher_monitor_subfolders = monitorSubfolders.checked;

    const deleteEmpty = document.getElementById('watcher-delete-empty');
    if (deleteEmpty) data.watcher_delete_empty_folders = deleteEmpty.checked;

    const minSize = document.getElementById('watcher-min-size');
    if (minSize) data.watcher_min_file_size_mb = parseInt(minSize.value) || 0;

    const issuesOrg = document.getElementById('watcher-issues-org');
    if (issuesOrg) data.watcher_issues_organization = issuesOrg.value;

    const autoPurge = document.getElementById('watcher-auto-purge');
    if (autoPurge) data.watcher_auto_purge_days = parseInt(autoPurge.value) || 0;

    // Companion types
    const companionChecks = document.querySelectorAll('.companion-type-check input[type="checkbox"]');
    if (companionChecks.length > 0) {
        data.watcher_companion_types = Array.from(companionChecks).filter(c => c.checked).map(c => c.value);
    }

    // Quality priorities from current DOM order
    const slots = document.querySelectorAll('#quality-priority-list .quality-priority-slot');
    if (slots.length > 0) {
        const pointValues = [100, 80, 60, 40, 20, 10];
        data.watcher_quality_priorities = Array.from(slots).map((slot, i) => ({
            factor: slot.dataset.factor,
            points: pointValues[i] || 0,
        }));
    }

    try {
        await api('/watcher/settings', {
            method: 'PUT',
            body: JSON.stringify(data),
        });
    } catch (e) {
        // error shown by api()
    }
}

async function startWatcher() {
    try {
        await api('/watcher/start', { method: 'POST' });
        showToast('Watcher started', 'success');
        loadWatcherData();
        updateWatcherStatusDot();
    } catch (e) {
        // error shown by api()
    }
}

async function stopWatcher() {
    try {
        await api('/watcher/stop', { method: 'POST' });
        showToast('Watcher stopped', 'success');
        loadWatcherData();
        updateWatcherStatusDot();
    } catch (e) {
        // error shown by api()
    }
}

// ── Quality priority drag-and-drop ──────────────────────────────

function initWatcherDragDrop() {
    const list = document.getElementById('quality-priority-list');
    if (!list) return;

    let draggedEl = null;

    list.querySelectorAll('.quality-priority-slot').forEach(slot => {
        slot.addEventListener('dragstart', (e) => {
            draggedEl = slot;
            slot.classList.add('dragging');
            e.dataTransfer.effectAllowed = 'move';
        });

        slot.addEventListener('dragend', () => {
            slot.classList.remove('dragging');
            list.querySelectorAll('.quality-priority-slot').forEach(s => s.classList.remove('drag-over'));
            draggedEl = null;
            // Update point labels after reorder
            updatePriorityPoints();
            autoSaveWatcherSettings();
        });

        slot.addEventListener('dragover', (e) => {
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            if (slot !== draggedEl) {
                slot.classList.add('drag-over');
            }
        });

        slot.addEventListener('dragleave', () => {
            slot.classList.remove('drag-over');
        });

        slot.addEventListener('drop', (e) => {
            e.preventDefault();
            slot.classList.remove('drag-over');
            if (draggedEl && draggedEl !== slot) {
                const allSlots = Array.from(list.querySelectorAll('.quality-priority-slot'));
                const fromIndex = allSlots.indexOf(draggedEl);
                const toIndex = allSlots.indexOf(slot);
                if (fromIndex < toIndex) {
                    slot.parentNode.insertBefore(draggedEl, slot.nextSibling);
                } else {
                    slot.parentNode.insertBefore(draggedEl, slot);
                }
            }
        });
    });
}

function updatePriorityPoints() {
    const pointValues = [100, 80, 60, 40, 20, 10];
    const slots = document.querySelectorAll('#quality-priority-list .quality-priority-slot');
    slots.forEach((slot, i) => {
        const rank = slot.querySelector('.priority-rank');
        if (rank) rank.textContent = `${pointValues[i] || 0} pts`;
    });
}

// ── Watcher status indicator (sidebar dot) ──────────────────────

let watcherStatusPollInterval = null;

function startWatcherStatusPoll() {
    if (watcherStatusPollInterval) return;
    updateWatcherStatusDot();
    watcherStatusPollInterval = setInterval(updateWatcherStatusDot, 15000);
}

async function updateWatcherStatusDot() {
    try {
        const data = await fetch('/api/watcher/status').then(r => r.json());
        const dot = document.getElementById('watcher-status-dot');
        if (dot) {
            dot.className = 'nav-watcher-dot status-' + (data.status || 'stopped');
            dot.title = 'Watcher: ' + (data.status || 'stopped');
        }
    } catch (e) {
        // Silently ignore
    }
}

// ── Watcher Log tab ─────────────────────────────────────────────

async function renderWatcherLogTab() {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">Watcher Activity Log</h3>
            </div>
            <div class="watcher-log-controls">
                <label>From:</label>
                <input type="date" id="watcher-log-from" value="${watcherLogState.dateFrom}" onchange="onWatcherLogDateChange()">
                <label>To:</label>
                <input type="date" id="watcher-log-to" value="${watcherLogState.dateTo}" onchange="onWatcherLogDateChange()">
                <button class="btn btn-sm btn-secondary" onclick="clearWatcherLogFilters()">Clear</button>
            </div>
            <div id="watcher-log-content">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    `;

    await loadWatcherLog();
}

async function loadWatcherLog() {
    const content = document.getElementById('watcher-log-content');
    if (!content) return;

    try {
        let url = `/watcher/log?limit=${watcherLogState.limit}&offset=${watcherLogState.offset}`;
        if (watcherLogState.dateFrom) url += `&date_from=${watcherLogState.dateFrom}`;
        if (watcherLogState.dateTo) url += `&date_to=${watcherLogState.dateTo}T23:59:59`;

        const data = await api(url);
        watcherLogState.entries = data.entries || [];
        watcherLogState.total = data.total || 0;

        renderWatcherLogEntries();
    } catch (e) {
        content.innerHTML = '<div class="alert alert-danger">Failed to load watcher log.</div>';
    }
}

function renderWatcherLogEntries() {
    const content = document.getElementById('watcher-log-content');
    if (!content) return;

    const entries = watcherLogState.entries;
    if (!entries.length) {
        content.innerHTML = `
            <div class="watcher-log-empty">
                <p>No log entries${watcherLogState.dateFrom || watcherLogState.dateTo ? ' for the selected date range' : ' yet'}.</p>
            </div>
        `;
        return;
    }

    // Group entries by date
    const groups = {};
    for (const entry of entries) {
        const date = entry.timestamp ? entry.timestamp.split('T')[0] : 'Unknown';
        if (!groups[date]) groups[date] = [];
        groups[date].push(entry);
    }

    let html = '';
    for (const [date, dateEntries] of Object.entries(groups)) {
        const displayDate = formatLogDate(date);
        html += `<div class="watcher-log-date-group">`;
        html += `<div class="watcher-log-date-header">${escapeHtml(displayDate)}</div>`;

        for (const entry of dateEntries) {
            const time = entry.timestamp ? formatLogTime(entry.timestamp) : '';
            const actionLabel = formatActionType(entry.action_type);
            const summary = buildLogSummary(entry);
            const resultClass = entry.result ? 'result-' + entry.result : '';
            const entryId = 'log-detail-' + entry.id;

            html += `
                <div class="watcher-log-entry" onclick="toggleLogDetail('${entryId}')">
                    <span class="log-entry-time">${time}</span>
                    <span class="log-entry-badge action-${escapeHtml(entry.action_type || '')}">${escapeHtml(actionLabel)}</span>
                    <span class="log-entry-summary">${escapeHtml(summary)}</span>
                    <span class="log-entry-result ${resultClass}">${escapeHtml(entry.result || '')}</span>
                </div>
                <div class="log-entry-details" id="${entryId}">
                    ${buildLogDetails(entry)}
                </div>
            `;
        }
        html += `</div>`;
    }

    // Pagination
    const totalPages = Math.ceil(watcherLogState.total / watcherLogState.limit);
    const currentPage = Math.floor(watcherLogState.offset / watcherLogState.limit) + 1;

    if (totalPages > 1) {
        html += `
            <div class="watcher-log-pagination">
                <button class="btn btn-sm btn-secondary" onclick="watcherLogPage('prev')" ${currentPage <= 1 ? 'disabled' : ''}>Previous</button>
                <span class="page-info">Page ${currentPage} of ${totalPages} (${watcherLogState.total} entries)</span>
                <button class="btn btn-sm btn-secondary" onclick="watcherLogPage('next')" ${currentPage >= totalPages ? 'disabled' : ''}>Next</button>
            </div>
        `;
    } else if (watcherLogState.total > 0) {
        html += `<div class="watcher-log-pagination"><span class="page-info">${watcherLogState.total} entries</span></div>`;
    }

    content.innerHTML = html;
}

function toggleLogDetail(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('open');
}

function formatLogDate(dateStr) {
    try {
        const d = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (d.getTime() === today.getTime()) return 'Today';
        if (d.getTime() === yesterday.getTime()) return 'Yesterday';
        return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

function formatLogTime(timestamp) {
    try {
        const d = new Date(timestamp);
        return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
    } catch {
        return '';
    }
}

function formatActionType(action) {
    const labels = {
        'file_detected': 'Detected',
        'match_found': 'Matched',
        'moved_to_library': 'Library',
        'moved_to_issues': 'Issues',
        'error': 'Error',
        'auto_import': 'Imported',
        'watcher_started': 'Started',
        'watcher_stopped': 'Stopped',
    };
    return labels[action] || action || 'Unknown';
}

function buildLogSummary(entry) {
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

function buildLogDetails(entry) {
    let html = '';
    if (entry.details) {
        html += `<div class="detail-row"><span class="detail-label">Details</span><span class="detail-value">${escapeHtml(entry.details)}</span></div>`;
    }
    if (entry.file_path) {
        html += `<div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${escapeHtml(entry.file_path)}</span></div>`;
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

function onWatcherLogDateChange() {
    watcherLogState.dateFrom = document.getElementById('watcher-log-from')?.value || '';
    watcherLogState.dateTo = document.getElementById('watcher-log-to')?.value || '';
    watcherLogState.offset = 0;
    loadWatcherLog();
}

function clearWatcherLogFilters() {
    watcherLogState.dateFrom = '';
    watcherLogState.dateTo = '';
    watcherLogState.offset = 0;
    const fromEl = document.getElementById('watcher-log-from');
    const toEl = document.getElementById('watcher-log-to');
    if (fromEl) fromEl.value = '';
    if (toEl) toEl.value = '';
    loadWatcherLog();
}

function watcherLogPage(dir) {
    if (dir === 'next') {
        watcherLogState.offset += watcherLogState.limit;
    } else {
        watcherLogState.offset = Math.max(0, watcherLogState.offset - watcherLogState.limit);
    }
    loadWatcherLog();
}
