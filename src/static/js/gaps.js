/**
 * Media Admin - Gaps (managed import review)
 *
 * A frozen snapshot of the 2026-09-08/09 managed import of /home/coex/drives/tv-shows,
 * baked from /home/coex/docs/media-import-2026-09-09-episode-gaps.md. Deliberately
 * static and import-only: the dashboard's Most Incomplete and Extra Files cards
 * already track the live library. Temporary — see the note at the foot of the page.
 */

let gapsData = null;
let activeGapsTab = 'summary';

function switchGapsTab(tab) {
    activeGapsTab = tab;
    setUiPref('activeGapsTab', tab);
    renderGaps();
}

async function renderGaps() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const saved = getUiPref('activeGapsTab', null);
    if (['summary', 'missing', 'extra'].includes(saved)) activeGapsTab = saved;

    if (!gapsData) {
        try {
            const res = await fetch('/static/gaps-import.json');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            gapsData = await res.json();
        } catch (e) {
            appContent.innerHTML = `<div class="card"><p class="text-muted text-center">Could not load the import report: ${escapeHtml(e.message)}</p></div>`;
            return;
        }
    }

    const shows = gapsData.shows;
    const withMissing = shows.filter(s => s.missing > 0);
    const withExtra = shows.filter(s => s.extra_count > 0);
    const totalMissing = shows.reduce((n, s) => n + s.missing, 0);
    const totalExtra = shows.reduce((n, s) => n + s.extra_count, 0);

    const body = {
        summary: () => renderGapsSummary(shows, withMissing, withExtra, totalMissing, totalExtra),
        missing: () => renderGapsMissing(withMissing, totalMissing),
        extra: () => renderGapsExtra(withExtra, totalExtra),
    }[activeGapsTab]();

    appContent.innerHTML = `
        <div class="page-header">
            <h1 class="page-title">Gaps</h1>
        </div>

        <div class="card" style="margin-bottom: 20px;">
            <p style="margin: 0;">
                The <strong>${gapsData.imported}</strong> shows added by the managed import of
                <code>/home/coex/drives/tv-shows</code> on 2026-09-08/09.
                <strong>${shows.length}</strong> have a gap;
                the other <strong>${gapsData.imported - shows.length}</strong> matched cleanly.
            </p>
            <p class="text-muted" style="margin: 10px 0 0;">
                A frozen snapshot, generated ${gapsData.generated} — it does not change as you fix
                things. For the live library use the dashboard's Most Incomplete and Extra Files cards.
            </p>
        </div>

        <div class="scan-tabs">
            <button class="scan-tab ${activeGapsTab === 'summary' ? 'active' : ''}" onclick="switchGapsTab('summary')">
                <img src="/static/images/nav-lists.png" class="tab-icon-img" alt="">Summary (${shows.length})
            </button>
            <button class="scan-tab ${activeGapsTab === 'missing' ? 'active' : ''}" onclick="switchGapsTab('missing')">
                <img src="/static/images/list-ignore.png" class="tab-icon-img" alt="">Missing (${totalMissing})
            </button>
            <button class="scan-tab ${activeGapsTab === 'extra' ? 'active' : ''}" onclick="switchGapsTab('extra')">
                <img src="/static/images/list-special.png" class="tab-icon-img" alt="">Extra (${totalExtra})
            </button>
        </div>

        <div id="gaps-tab-content">${body}</div>
    `;
}

function renderGapsSummary(shows, withMissing, withExtra, totalMissing, totalExtra) {
    return `
        <div class="stats-grid" style="margin-bottom: 20px;">
            <div class="stat-card warning">
                <div class="stat-value">${totalMissing}</div>
                <div class="stat-label">Episodes missing (${withMissing.length} shows)</div>
            </div>
            <div class="stat-card special">
                <div class="stat-value">${totalExtra}</div>
                <div class="stat-label">Unmatched files (${withExtra.length} shows)</div>
            </div>
        </div>

        <div class="card">
            <p class="text-muted" style="margin-bottom: 15px;">
                <strong>Tracked</strong> is found + missing + not aired — the episodes media-admin holds
                accountable. Season 0 specials are never counted as missing, so they sit in their own
                column and are excluded from Tracked.
            </p>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Show</th>
                            <th style="text-align: right;">Found</th>
                            <th style="text-align: right;">Tracked</th>
                            <th style="text-align: right;">Missing</th>
                            <th style="text-align: right;">Extra</th>
                            <th style="text-align: right;">Not aired</th>
                            <th style="text-align: right;">Specials</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shows.map(s => `
                            <tr>
                                <td>${escapeHtml(s.name)}</td>
                                <td style="text-align: right;">${s.found}</td>
                                <td style="text-align: right;">${s.tracked}</td>
                                <td style="text-align: right;">${s.missing ? `<span class="badge badge-warning">${s.missing}</span>` : ''}</td>
                                <td style="text-align: right;">${s.extra_count ? `<span class="badge">${s.extra_count}</span>` : ''}</td>
                                <td style="text-align: right;">${s.not_aired || ''}</td>
                                <td style="text-align: right;">${s.specials || ''}</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderGapsMissing(shows, total) {
    return `
        <div class="card">
            <div class="card-header"><h3 class="card-title">${total} episodes missing across ${shows.length} shows</h3></div>
            <p class="text-muted">
                Episodes the metadata provider lists as aired, with no file in the library folder.
                Specials and unaired episodes are excluded.
            </p>
            ${shows.map(s => `
                <div style="padding: 14px 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 15px;">
                        <strong>${escapeHtml(s.name)}</strong>
                        <span class="badge badge-warning">${s.missing} missing</span>
                    </div>
                    <div class="text-muted" style="font-size: 0.85rem; margin: 4px 0;"><code>${escapeHtml(s.folder)}</code></div>
                    <div style="font-family: monospace; font-size: 0.85rem;">${escapeHtml(s.missing_ranges)}</div>
                </div>
            `).join('')}
        </div>
    `;
}

function renderGapsExtra(shows, total) {
    return `
        <div class="card">
            <div class="card-header"><h3 class="card-title">${total} unmatched files across ${shows.length} shows</h3></div>
            <p class="text-muted">
                Video files the scanner never linked to an episode record. They play fine —
                media-admin just has nowhere to file them. Two causes dominate: two series sharing
                one folder (Wet Hot American Summer holds both <em>First Day of Camp</em> and
                <em>Ten Years Later</em>), or a folder numbering its seasons differently from the
                provider, common in long-running cartoons.
            </p>
            ${shows.map((s, i) => `
                <div style="padding: 14px 0; border-bottom: 1px solid var(--border-color);">
                    <div style="display: flex; justify-content: space-between; align-items: baseline; gap: 15px;">
                        <strong>${escapeHtml(s.name)}</strong>
                        <span class="badge">${s.extra_count} extra</span>
                    </div>
                    <div class="text-muted" style="font-size: 0.85rem; margin: 4px 0;"><code>${escapeHtml(s.folder)}</code></div>
                    <div style="font-family: monospace; font-size: 0.85rem;">${escapeHtml(s.extra_ranges)}</div>
                    <a href="#" onclick="toggleGapsFiles(${i}); return false;" style="font-size: 0.85rem;">Show filenames</a>
                    <div id="gaps-files-${i}" style="display: none; margin-top: 8px; font-family: monospace; font-size: 0.8rem;">
                        ${s.extra_files.map(f => `<div>${escapeHtml(f)}</div>`).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;
}

function toggleGapsFiles(i) {
    const el = document.getElementById(`gaps-files-${i}`);
    if (el) el.style.display = el.style.display === 'none' ? 'block' : 'none';
}
