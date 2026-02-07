/**
 * Media Admin - Issues tab (scan page)
 * Lists files in the configured Issues folder with Year > Month > Day hierarchy.
 */

let issuesState = { files: [], total: 0, issuesFolder: '', searchQuery: '' };

// ── Rendering ────────────────────────────────────────────────────

async function renderIssuesTab() {
    const container = document.getElementById('scan-tab-content');
    if (!container) return;

    container.innerHTML = `
        <div class="card">
            <div class="card-header" style="display: flex; align-items: center; justify-content: space-between;">
                <h3 class="card-title">Issues</h3>
                <div class="card-control-btns">
                    <button class="card-control-btn" onclick="issuesCollapseAll()" title="Collapse all"><img src="/static/images/show-expand.png" alt="Collapse all"></button>
                    <button class="card-control-btn" onclick="issuesExpandAll()" title="Expand all"><img src="/static/images/show-collapse.png" alt="Expand all"></button>
                    <button class="btn btn-sm btn-danger" onclick="confirmClearAllIssues()" style="margin-left: 8px;">Clear All</button>
                </div>
            </div>
            <div class="watcher-log-controls">
                <label>Search:</label>
                <input type="text" id="issues-search" placeholder="Search..." value="${issuesState.searchQuery}" oninput="onIssuesSearchChange()">
                <button class="btn btn-sm btn-secondary" onclick="clearIssuesSearch()">Clear</button>
            </div>
            <div id="issues-content">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    `;

    await loadIssuesFiles();
}

async function loadIssuesFiles() {
    const content = document.getElementById('issues-content');
    if (!content) return;

    try {
        const data = await api('/watcher/issues');
        issuesState.files = data.files || [];
        issuesState.total = data.total || 0;
        issuesState.issuesFolder = data.issues_folder || '';
        renderIssuesEntries();
    } catch (e) {
        content.innerHTML = '<div class="alert alert-danger">Failed to load issues files.</div>';
    }
}

function onIssuesSearchChange() {
    issuesState.searchQuery = document.getElementById('issues-search')?.value || '';
    renderIssuesEntries();
}

function clearIssuesSearch() {
    issuesState.searchQuery = '';
    const searchEl = document.getElementById('issues-search');
    if (searchEl) searchEl.value = '';
    renderIssuesEntries();
}

function renderIssuesEntries() {
    const content = document.getElementById('issues-content');
    if (!content) return;

    let files = issuesState.files;

    if (issuesState.searchQuery) {
        const q = issuesState.searchQuery.toLowerCase();
        files = files.filter(f => f.name.toLowerCase().includes(q));
    }

    if (!files.length) {
        content.innerHTML = `
            <div class="watcher-log-empty">
                <p>${!issuesState.issuesFolder ? 'Issues folder not configured.' : issuesState.searchQuery ? 'No files matching the search.' : 'No files in the issues folder.'}</p>
            </div>
        `;
        return;
    }

    // Build hierarchy: year > month > day from file modified dates
    const hierarchy = {};
    for (const file of files) {
        const date = file.modified ? file.modified.split('T')[0] : 'Unknown';
        const parts = date.split('-');
        if (parts.length < 3) continue;
        const year = parts[0], month = parts[1], day = parts[2];
        if (!hierarchy[year]) hierarchy[year] = {};
        if (!hierarchy[year][month]) hierarchy[year][month] = {};
        if (!hierarchy[year][month][day]) hierarchy[year][month][day] = [];
        hierarchy[year][month][day].push(file);
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
        const yearKey = 'issues-' + year;
        activeKeys.push(yearKey);
        const yearDefault = (year === currentYear);
        const yearExpanded = isIssuesNodeExpanded(yearKey, yearDefault);

        let yearCount = 0;
        for (const m of Object.keys(hierarchy[year])) {
            for (const d of Object.keys(hierarchy[year][m])) {
                yearCount += hierarchy[year][m][d].length;
            }
        }

        html += `<div class="wlog-year-header" onclick="toggleIssuesNode('${yearKey}', this)">
            <img src="/static/images/${yearExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
            <span class="wlog-year-label">${year}</span>
            <span class="wlog-node-count">(${yearCount})</span>
            <span class="wlog-header-actions" onclick="event.stopPropagation()">
                <img src="/static/images/show-expand.png" class="wlog-action-btn" onclick="issuesCollapseAllMonths('${year}')" title="Collapse months" alt="Collapse">
                <img src="/static/images/show-collapse.png" class="wlog-action-btn" onclick="issuesExpandAllMonths('${year}')" title="Expand months" alt="Expand">
            </span>
        </div>`;
        html += `<div class="wlog-year-content ${yearExpanded ? 'open' : ''}">`;

        const monthKeys = Object.keys(hierarchy[year]).sort((a, b) => b - a);
        for (const month of monthKeys) {
            const monthKey = 'issues-' + year + '-' + month;
            activeKeys.push(monthKey);
            const monthDefault = (year === currentYear && month === currentMonth);
            const monthExpanded = isIssuesNodeExpanded(monthKey, monthDefault);

            let monthCount = 0;
            for (const d of Object.keys(hierarchy[year][month])) {
                monthCount += hierarchy[year][month][d].length;
            }

            const monthNum = parseInt(month, 10);
            const monthLabel = monthNames[monthNum] || month;

            html += `<div class="wlog-month-header" onclick="toggleIssuesNode('${monthKey}', this)">
                <img src="/static/images/${monthExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
                <span class="wlog-month-label">${monthLabel}</span>
                <span class="wlog-node-count">(${monthCount})</span>
                <span class="wlog-header-actions" onclick="event.stopPropagation()">
                    <img src="/static/images/show-expand.png" class="wlog-action-btn" onclick="issuesCollapseAllDays('${monthKey}')" title="Collapse days" alt="Collapse">
                    <img src="/static/images/show-collapse.png" class="wlog-action-btn" onclick="issuesExpandAllDays('${monthKey}')" title="Expand days" alt="Expand">
                </span>
            </div>`;
            html += `<div class="wlog-month-content ${monthExpanded ? 'open' : ''}">`;

            const dayKeys = Object.keys(hierarchy[year][month]).sort((a, b) => b - a);
            for (const day of dayKeys) {
                const dayKey = 'issues-' + year + '-' + month + '-' + day;
                activeKeys.push(dayKey);
                const dayDefault = (year === currentYear && month === currentMonth && day === currentDay);
                const dayExpanded = isIssuesNodeExpanded(dayKey, dayDefault);
                const dayFiles = hierarchy[year][month][day];

                const dateStr = year + '-' + month + '-' + day;
                const displayDate = formatIssuesDate(dateStr);

                html += `<div class="wlog-day-header" onclick="toggleIssuesNode('${dayKey}', this)">
                    <img src="/static/images/${dayExpanded ? 'show-collapse.png' : 'show-expand.png'}" class="wlog-chevron" alt="">
                    <span class="wlog-day-label">${escapeHtml(displayDate)}</span>
                    <span class="wlog-node-count">(${dayFiles.length})</span>
                </div>`;
                html += `<div class="wlog-day-content ${dayExpanded ? 'open' : ''}">`;

                for (const file of dayFiles) {
                    const time = file.modified ? formatLogTime(file.modified) : '';
                    const entryId = 'issues-detail-' + file.path.replace(/[^a-zA-Z0-9]/g, '-');

                    html += `
                        <div class="watcher-log-entry issues-file-entry" onclick="toggleIssuesDetail('${entryId}')">
                            <span class="log-entry-time">${time}</span>
                            <span class="issues-file-name" title="${escapeHtml(file.name)}">${escapeHtml(file.name)}</span>
                            <span class="issues-file-size">${formatFileSize(file.size)}</span>
                            ${file.subfolder ? `<span class="issues-file-subfolder">${escapeHtml(file.subfolder)}</span>` : ''}
                            <img src="/static/images/trash.png" class="wlog-delete-btn wlog-entry-delete" onclick="event.stopPropagation(); deleteIssuesFile('${escapeHtml(file.path).replace(/'/g, "\\'")}', '${escapeHtml(file.name).replace(/'/g, "\\'")}')" title="Delete file" alt="Delete">
                        </div>
                        <div class="log-entry-details issues-file-details" id="${entryId}">
                            <div class="detail-row"><span class="detail-label">File</span><span class="detail-value">${escapeHtml(file.name)}</span></div>
                            <div class="detail-row"><span class="detail-label">Path</span><span class="detail-value">${escapeHtml(file.full_path)}</span></div>
                            ${file.subfolder ? `<div class="detail-row"><span class="detail-label">Subfolder</span><span class="detail-value">${escapeHtml(file.subfolder)}</span></div>` : ''}
                            <div class="detail-row"><span class="detail-label">Size</span><span class="detail-value">${formatFileSize(file.size)} (${file.size.toLocaleString()} bytes)</span></div>
                            <div class="detail-row"><span class="detail-label">Modified</span><span class="detail-value">${escapeHtml(file.modified)}</span></div>
                        </div>
                    `;
                }

                html += `</div>`; // day-content
            }

            html += `</div>`; // month-content
        }

        html += `</div>`; // year-content
    }

    cleanupStaleIssuesManualStates(activeKeys);

    if (issuesState.total > 0) {
        html += `<div class="watcher-log-pagination"><span class="page-info">${issuesState.total} files</span></div>`;
    }

    content.innerHTML = html;
}

// ── Expand / Collapse state ─────────────────────────────────────

function getIssuesManualState() {
    return getUiPref('issuesManualState', {});
}

function setIssuesManualState(key, expanded) {
    const states = getIssuesManualState();
    states[key] = expanded;
    setUiPref('issuesManualState', states);
}

function cleanupStaleIssuesManualStates(activeKeys) {
    const states = getIssuesManualState();
    const activeSet = new Set(activeKeys);
    let changed = false;
    for (const key of Object.keys(states)) {
        if (!activeSet.has(key)) {
            delete states[key];
            changed = true;
        }
    }
    if (changed) setUiPref('issuesManualState', states);
}

function isIssuesNodeExpanded(key, defaultExpanded) {
    const manual = getIssuesManualState();
    if (key in manual) return manual[key];
    return defaultExpanded;
}

function toggleIssuesNode(key, headerEl) {
    const contentEl = headerEl.nextElementSibling;
    const chevron = headerEl.querySelector('.wlog-chevron');
    if (!contentEl) return;
    const isOpen = contentEl.classList.contains('open');
    contentEl.classList.toggle('open', !isOpen);
    if (chevron) chevron.src = isOpen ? '/static/images/show-expand.png' : '/static/images/show-collapse.png';
    setIssuesManualState(key, !isOpen);
}

function toggleIssuesDetail(id) {
    const el = document.getElementById(id);
    if (el) el.classList.toggle('open');
}

// ── Collapse / Expand all ───────────────────────────────────────

function _issuesSetAll(headerClass, expanded) {
    document.querySelectorAll(`#issues-content .${headerClass}`).forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.toggle('open', expanded);
        if (chevron) chevron.src = expanded ? '/static/images/show-collapse.png' : '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], expanded);
    });
}

function issuesCollapseAll() {
    _issuesSetAll('wlog-year-header', false);
    _issuesSetAll('wlog-month-header', false);
    _issuesSetAll('wlog-day-header', false);
}

function issuesExpandAll() {
    _issuesSetAll('wlog-year-header', true);
    _issuesSetAll('wlog-month-header', true);
    _issuesSetAll('wlog-day-header', true);
}

function issuesCollapseAllMonths(year) {
    const yearKey = 'issues-' + year;
    const yearHeader = document.querySelector(`#issues-content .wlog-year-header[onclick*="'${yearKey}'"]`);
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
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], false);
    });
    yearContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.remove('open');
        if (chevron) chevron.src = '/static/images/show-expand.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], false);
    });
}

function issuesExpandAllMonths(year) {
    const yearKey = 'issues-' + year;
    const yearHeader = document.querySelector(`#issues-content .wlog-year-header[onclick*="'${yearKey}'"]`);
    if (!yearHeader) return;
    const yearContent = yearHeader.nextElementSibling;
    if (!yearContent) return;
    yearContent.classList.add('open');
    const yearChevron = yearHeader.querySelector('.wlog-chevron');
    if (yearChevron) yearChevron.src = '/static/images/show-collapse.png';
    setIssuesManualState(yearKey, true);
    yearContent.querySelectorAll('.wlog-month-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], true);
    });
    yearContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], true);
    });
}

function issuesCollapseAllDays(monthKey) {
    const monthHeader = document.querySelector(`#issues-content .wlog-month-header[onclick*="'${monthKey}'"]`);
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
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], false);
    });
}

function issuesExpandAllDays(monthKey) {
    const monthHeader = document.querySelector(`#issues-content .wlog-month-header[onclick*="'${monthKey}'"]`);
    if (!monthHeader) return;
    const monthContent = monthHeader.nextElementSibling;
    if (!monthContent) return;
    monthContent.classList.add('open');
    const monthChevron = monthHeader.querySelector('.wlog-chevron');
    if (monthChevron) monthChevron.src = '/static/images/show-collapse.png';
    setIssuesManualState(monthKey, true);
    monthContent.querySelectorAll('.wlog-day-header').forEach(header => {
        const content = header.nextElementSibling;
        const chevron = header.querySelector('.wlog-chevron');
        if (!content) return;
        content.classList.add('open');
        if (chevron) chevron.src = '/static/images/show-collapse.png';
        const onclick = header.getAttribute('onclick') || '';
        const match = onclick.match(/toggleIssuesNode\('([^']+)'/);
        if (match) setIssuesManualState(match[1], true);
    });
}

// ── Delete functions ────────────────────────────────────────────

function deleteIssuesFile(relativePath, fileName) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Delete File';
    modalBody.innerHTML = `
        <p>Delete this file from the issues folder?</p>
        <p class="text-muted" style="word-break: break-all;">${escapeHtml(fileName)}</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="confirmDeleteIssuesFile('${escapeHtml(relativePath).replace(/'/g, "\\'")}')">Delete</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function confirmDeleteIssuesFile(relativePath) {
    closeModal();
    try {
        const result = await api('/watcher/issues', {
            method: 'DELETE',
            body: JSON.stringify({ path: relativePath }),
        });
        showToast(result.message, 'success');
        await loadIssuesFiles();
    } catch (error) {
        // Error already shown
    }
}

function confirmClearAllIssues() {
    if (issuesState.total === 0) {
        showToast('No files to clear', 'info');
        return;
    }

    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Clear All Issues';
    modalBody.innerHTML = `
        <p>Are you sure you want to delete <strong>all ${issuesState.total}</strong> file${issuesState.total === 1 ? '' : 's'} from the issues folder?</p>
        <p class="text-muted">This action cannot be undone.</p>
        <div class="modal-buttons" style="margin-top: 20px;">
            <button class="btn btn-danger" onclick="executeClearAllIssues()">Delete All Files</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');
}

async function executeClearAllIssues() {
    closeModal();
    try {
        const result = await api('/watcher/issues/all', { method: 'DELETE' });
        showToast(result.message, 'success');
        await loadIssuesFiles();
    } catch (error) {
        // Error already shown
    }
}

// ── Helpers ─────────────────────────────────────────────────────

function formatFileSize(bytes) {
    if (bytes == null || bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    const val = bytes / Math.pow(1024, i);
    return val.toFixed(i > 0 ? 1 : 0) + ' ' + units[i];
}

function formatIssuesDate(dateStr) {
    try {
        const tz = getConfiguredTimezone();
        const d = new Date(dateStr + 'T00:00:00');
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const yesterday = new Date(today);
        yesterday.setDate(yesterday.getDate() - 1);

        if (d.getTime() === today.getTime()) return 'Today';
        if (d.getTime() === yesterday.getTime()) return 'Yesterday';
        return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric', timeZone: tz });
    } catch {
        return dateStr;
    }
}
