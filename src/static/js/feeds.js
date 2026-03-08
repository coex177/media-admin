/**
 * Media Admin - Feeds (RSS feed viewer)
 */

let activeFeedId = null;
let feedsCache = [];

// ── Read-entry tracking (persisted via UI prefs) ──
// Key format: "link::date" so reused URLs with new dates appear unread.

function getFeedReadEntries() {
    return getUiPref('feedReadEntries', {});
}

function entryKey(link, date) {
    return date ? link + '::' + date : link;
}

function isEntryRead(feedId, link, date) {
    const read = getFeedReadEntries();
    return (read[feedId] || []).includes(entryKey(link, date));
}

function markEntryRead(feedId, link, date, checked) {
    const read = getFeedReadEntries();
    const list = read[feedId] || [];
    const key = entryKey(link, date);
    if (checked && !list.includes(key)) {
        list.push(key);
    } else if (!checked) {
        const idx = list.indexOf(key);
        if (idx !== -1) list.splice(idx, 1);
    }
    read[feedId] = list;
    setUiPref('feedReadEntries', read);
}

function toggleEntryRead(feedId, link, date, checkbox) {
    const row = checkbox.closest('.feed-entry-row');
    markEntryRead(feedId, link, date, checkbox.checked);
    if (row) row.classList.toggle('feed-entry-read', checkbox.checked);
}

function onEntryLinkClick(feedId, link, date, anchor) {
    const row = anchor.closest('.feed-entry-row');
    if (!row) return;
    const cb = row.querySelector('.feed-entry-checkbox');
    if (cb && !cb.checked) {
        cb.checked = true;
        toggleEntryRead(feedId, link, date, cb);
    }
}

// ── Tab ordering (persisted via UI prefs) ──

function getFeedTabOrder() {
    return getUiPref('feedTabOrder', []);
}

function saveFeedTabOrder(order) {
    setUiPref('feedTabOrder', order);
}

function getOrderedFeeds(feeds) {
    const saved = getFeedTabOrder();
    if (!saved.length) return feeds;
    const byId = {};
    feeds.forEach(f => byId[f.id] = f);
    const ordered = [];
    saved.forEach(id => {
        if (byId[id]) {
            ordered.push(byId[id]);
            delete byId[id];
        }
    });
    // Append any new feeds not in the saved order
    Object.values(byId).forEach(f => ordered.push(f));
    return ordered;
}

// ── Drag and drop state ──

let draggedTabId = null;

function onTabDragStart(e, feedId) {
    draggedTabId = feedId;
    e.dataTransfer.effectAllowed = 'move';
    e.target.classList.add('feed-tab-dragging');
}

function onTabDragEnd(e) {
    draggedTabId = null;
    e.target.classList.remove('feed-tab-dragging');
    document.querySelectorAll('.scan-tab').forEach(t => t.classList.remove('feed-tab-dragover'));
}

function onTabDragOver(e) {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
}

function onTabDragEnter(e) {
    const tab = e.target.closest('.scan-tab');
    if (tab && parseInt(tab.dataset.feedId) !== draggedTabId) {
        tab.classList.add('feed-tab-dragover');
    }
}

function onTabDragLeave(e) {
    const tab = e.target.closest('.scan-tab');
    if (tab) tab.classList.remove('feed-tab-dragover');
}

function onTabDrop(e, targetFeedId) {
    e.preventDefault();
    if (draggedTabId === null || draggedTabId === targetFeedId) return;

    // Compute new order
    const currentOrder = getOrderedFeeds(feedsCache).map(f => f.id);
    const fromIdx = currentOrder.indexOf(draggedTabId);
    const toIdx = currentOrder.indexOf(targetFeedId);
    if (fromIdx === -1 || toIdx === -1) return;

    currentOrder.splice(fromIdx, 1);
    currentOrder.splice(toIdx, 0, draggedTabId);

    saveFeedTabOrder(currentOrder);

    // Re-sort feedsCache in-place to match and rebuild tabs
    const byId = {};
    feedsCache.forEach(f => byId[f.id] = f);
    feedsCache = currentOrder.map(id => byId[id]).filter(Boolean);

    rebuildTabBar();
}

function rebuildTabBar() {
    const container = document.querySelector('.scan-tabs');
    if (!container) return;

    container.innerHTML = feedsCache.map(feed => `
        <button class="scan-tab${feed.id === activeFeedId ? ' active' : ''}"
                data-feed-id="${feed.id}"
                draggable="true"
                onclick="switchFeedTab(${feed.id})"
                ondblclick="startTabRename(${feed.id}, this)"
                ondragstart="onTabDragStart(event, ${feed.id})"
                ondragend="onTabDragEnd(event)"
                ondragover="onTabDragOver(event)"
                ondragenter="onTabDragEnter(event)"
                ondragleave="onTabDragLeave(event)"
                ondrop="onTabDrop(event, ${feed.id})">${escapeHtml(feed.title || feed.url)}</button>
    `).join('');
}

// ── Double-click to rename ──

function startTabRename(feedId, btn) {
    const feed = feedsCache.find(f => f.id === feedId);
    if (!feed) return;

    const currentTitle = feed.title || feed.url;
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'feed-tab-rename-input';
    input.value = currentTitle;

    // Replace button content with input
    btn.textContent = '';
    btn.appendChild(input);
    btn.classList.add('feed-tab-renaming');

    // Prevent tab switching while renaming
    btn.onclick = null;
    btn.draggable = false;

    input.focus();
    input.select();

    const commit = () => finishTabRename(feedId, input, btn);

    input.addEventListener('blur', commit, { once: true });
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            input.blur();
        } else if (e.key === 'Escape') {
            // Revert — set value back so commit saves nothing
            input.value = currentTitle;
            input.blur();
        }
    });
}

async function finishTabRename(feedId, input, btn) {
    const newTitle = input.value.trim();
    const feed = feedsCache.find(f => f.id === feedId);
    const oldTitle = feed ? (feed.title || feed.url) : '';

    // Restore the button
    btn.classList.remove('feed-tab-renaming');
    btn.draggable = true;
    btn.onclick = () => switchFeedTab(feedId);
    btn.ondblclick = () => startTabRename(feedId, btn);

    if (!newTitle || newTitle === oldTitle) {
        btn.textContent = oldTitle;
        return;
    }

    btn.textContent = newTitle;

    try {
        const updated = await api(`/feeds/${feedId}`, {
            method: 'PATCH',
            body: JSON.stringify({ title: newTitle })
        });
        if (feed) feed.title = updated.title;
    } catch (error) {
        // Revert on failure
        btn.textContent = oldTitle;
    }
}

// ── Main render ──

async function renderFeeds() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const feeds = await api('/feeds');
        feedsCache = getOrderedFeeds(feeds);

        if (feedsCache.length === 0) {
            appContent.innerHTML = `
                <div class="page-header">
                    <h1 class="page-title">Feeds</h1>
                    <button class="btn btn-primary" onclick="showAddFeedModal()">+ Add Feed</button>
                </div>
                <div class="card">
                    <p class="text-muted text-center">No feeds added yet. Click "+ Add Feed" to get started.</p>
                </div>
            `;
            return;
        }

        // Restore last active tab, or default to first feed
        const savedTab = getUiPref('activeFeedTab', null);
        if (savedTab && feedsCache.some(f => f.id === savedTab)) {
            activeFeedId = savedTab;
        } else {
            activeFeedId = feedsCache[0].id;
        }

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Feeds</h1>
                <button class="btn btn-primary" onclick="showAddFeedModal()">+ Add Feed</button>
            </div>
            <div class="scan-tabs"></div>
            <div id="feed-tab-content"></div>
        `;

        rebuildTabBar();
        renderFeedTabContent(activeFeedId);
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load feeds.</div>`;
    }
}

function switchFeedTab(feedId) {
    if (feedId === activeFeedId) return;
    activeFeedId = feedId;
    setUiPref('activeFeedTab', feedId);

    document.querySelectorAll('.scan-tabs .scan-tab').forEach(btn => {
        btn.classList.toggle('active', parseInt(btn.dataset.feedId) === feedId);
    });

    renderFeedTabContent(feedId);
}

function renderFeedTabContent(feedId) {
    const container = document.getElementById('feed-tab-content');
    if (!container) return;

    const feed = feedsCache.find(f => f.id === feedId);
    if (!feed) return;

    container.innerHTML = `
        <div class="card" id="feed-card-${feed.id}">
            <div class="feed-card-header">
                <p class="text-muted feed-url">${escapeHtml(feed.url)}</p>
                <button class="btn btn-danger btn-sm" onclick="deleteFeed(${feed.id})" title="Remove feed">Delete</button>
            </div>
            <div class="feed-entries" id="feed-entries-${feed.id}">
                <div class="loading"><div class="spinner"></div></div>
            </div>
        </div>
    `;

    loadFeedEntries(feed.id);
}

async function loadFeedEntries(feedId) {
    const container = document.getElementById(`feed-entries-${feedId}`);
    if (!container) return;

    try {
        const entries = await api(`/feeds/${feedId}/entries`);

        if (entries.length === 0) {
            container.innerHTML = '<p class="text-muted">No entries found.</p>';
            return;
        }

        container.innerHTML = `
            <div class="feed-entry-list">
                ${entries.map(entry => {
                    const categories = (entry.categories || []).map(c =>
                        `<span class="badge badge-secondary">${escapeHtml(c)}</span>`
                    ).join(' ');

                    const date = entry.date ? formatFeedDate(entry.date) : '';
                    const linkEscaped = escapeHtml(entry.link);
                    const linkJs = entry.link.replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    const dateJs = (entry.date || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
                    const read = isEntryRead(feedId, entry.link, entry.date);

                    return `
                        <div class="feed-entry-row${read ? ' feed-entry-read' : ''}">
                            <div class="feed-entry-top">
                                <input type="checkbox" class="feed-entry-checkbox" ${read ? 'checked' : ''}
                                       onchange="toggleEntryRead(${feedId}, '${linkJs}', '${dateJs}', this)">
                                <div class="feed-entry-main">
                                    <a href="${linkEscaped}" target="_blank" rel="noopener" class="feed-entry-title"
                                       onclick="onEntryLinkClick(${feedId}, '${linkJs}', '${dateJs}', this)">${escapeHtml(entry.title)}</a>
                                    ${date ? `<span class="feed-entry-date text-muted">${date}</span>` : ''}
                                </div>
                            </div>
                            ${categories ? `<div class="feed-entry-categories">${categories}</div>` : ''}
                        </div>
                    `;
                }).join('')}
            </div>
        `;
    } catch (error) {
        container.innerHTML = '<p class="text-muted">Failed to load entries.</p>';
    }
}

function formatFeedDate(dateStr) {
    try {
        const d = new Date(dateStr);
        if (isNaN(d.getTime())) return dateStr;
        return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
    } catch {
        return dateStr;
    }
}

function showAddFeedModal() {
    const modal = document.getElementById('modal');
    const modalTitle = document.getElementById('modal-title');
    const modalBody = document.getElementById('modal-body');

    modalTitle.textContent = 'Add Feed';
    modalBody.innerHTML = `
        <div class="form-group">
            <label class="form-label">Feed URL</label>
            <input type="url" id="add-feed-url" class="form-control" placeholder="https://example.com/feed/" autofocus>
        </div>
        <div class="modal-buttons">
            <button class="btn btn-primary" onclick="submitAddFeed()">Add Feed</button>
            <button class="btn btn-outline" onclick="closeModal()">Cancel</button>
        </div>
    `;
    modal.classList.add('active');

    setTimeout(() => {
        const input = document.getElementById('add-feed-url');
        if (input) {
            input.focus();
            input.addEventListener('keydown', (e) => {
                if (e.key === 'Enter') submitAddFeed();
            });
        }
    }, 100);
}

async function submitAddFeed() {
    const input = document.getElementById('add-feed-url');
    const url = input ? input.value.trim() : '';

    if (!url) {
        showToast('Please enter a feed URL', 'warning');
        return;
    }

    closeModal();

    try {
        showToast('Adding feed...', 'info');
        await api('/feeds', {
            method: 'POST',
            body: JSON.stringify({ url })
        });
        showToast('Feed added', 'success');
        renderFeeds();
    } catch (error) {
        // Error already shown by api()
    }
}

async function deleteFeed(feedId) {
    try {
        await fetch(`${API_BASE}/feeds/${feedId}`, { method: 'DELETE' });
        showToast('Feed removed', 'success');
        // Clean up the saved order
        const order = getFeedTabOrder().filter(id => id !== feedId);
        saveFeedTabOrder(order);
        renderFeeds();
    } catch (error) {
        showToast('Failed to remove feed', 'error');
    }
}
