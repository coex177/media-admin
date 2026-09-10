/**
 * Media Admin - Gaps (library completeness)
 *
 * Two views over the library: episodes the provider lists that are not on disk,
 * and video files on disk that no episode record claims. Both read endpoints
 * that already back the dashboard cards — this is the full list, not the top 5.
 */

let activeGapsTab = 'missing';

function switchGapsTab(tab) {
    activeGapsTab = tab;
    setUiPref('activeGapsTab', tab);
    renderGaps();
}

async function renderGaps() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    const saved = getUiPref('activeGapsTab', null);
    if (saved === 'missing' || saved === 'extra') activeGapsTab = saved;

    try {
        const [missing, extra] = await Promise.all([
            api('/most-incomplete?limit=1000'),
            api('/extra-files'),
        ]);

        const missingEpisodes = missing.reduce((n, s) => n + s.episodes_missing, 0);
        const extraFiles = extra.reduce((n, s) => n + s.extra, 0);

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Gaps</h1>
            </div>

            <div class="scan-tabs">
                <button class="scan-tab ${activeGapsTab === 'missing' ? 'active' : ''}"
                        onclick="switchGapsTab('missing')">
                    <img src="/static/images/nav-lists.png" class="tab-icon-img" alt="">
                    Missing (${missing.length})
                </button>
                <button class="scan-tab ${activeGapsTab === 'extra' ? 'active' : ''}"
                        onclick="switchGapsTab('extra')">
                    <img src="/static/images/list-special.png" class="tab-icon-img" alt="">
                    Extra (${extra.length})
                </button>
            </div>

            <div id="gaps-tab-content">
                ${activeGapsTab === 'missing'
                    ? renderMissingTab(missing, missingEpisodes)
                    : renderExtraTab(extra, extraFiles)}
            </div>
        `;
    } catch (error) {
        appContent.innerHTML = `<div class="card"><p class="text-muted text-center">Could not load gaps: ${error.message}</p></div>`;
    }
}

function renderMissingTab(shows, totalEpisodes) {
    if (shows.length === 0) {
        return '<div class="card"><p class="text-muted text-center">No missing episodes. The library is complete.</p></div>';
    }

    return `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${totalEpisodes} episodes missing across ${shows.length} shows</h3>
            </div>
            <p class="text-muted" style="margin-bottom: 15px;">
                Aired episodes the metadata provider lists with no file in the library folder.
                Specials and episodes that have not aired yet are excluded.
            </p>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Show</th>
                            <th style="text-align: right;">Found</th>
                            <th style="text-align: right;">Missing</th>
                            <th style="text-align: right;">Aired</th>
                            <th style="text-align: right;">Complete</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shows.map(s => `
                            <tr style="cursor: pointer;" onclick="showShowDetail(${s.id})">
                                <td>${escapeHtml(s.name)}</td>
                                <td style="text-align: right;">${s.episodes_found}</td>
                                <td style="text-align: right;"><span class="badge badge-warning">${s.episodes_missing}</span></td>
                                <td style="text-align: right;">${s.total_aired}</td>
                                <td style="text-align: right;">${s.completion_percent}%</td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}

function renderExtraTab(shows, totalFiles) {
    if (shows.length === 0) {
        return '<div class="card"><p class="text-muted text-center">Every video file on disk is matched to an episode.</p></div>';
    }

    return `
        <div class="card">
            <div class="card-header">
                <h3 class="card-title">${totalFiles} unmatched files across ${shows.length} shows</h3>
            </div>
            <p class="text-muted" style="margin-bottom: 15px;">
                More video files in the library folder than matched episodes. Usually either two
                series sharing one folder, or a folder that numbers its seasons differently from
                the provider. The files play fine — media-admin just has nowhere to file them.
            </p>
            <div class="table-container">
                <table>
                    <thead>
                        <tr>
                            <th>Show</th>
                            <th style="text-align: right;">Matched</th>
                            <th style="text-align: right;">Files on disk</th>
                            <th style="text-align: right;">Extra</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${shows.map(s => `
                            <tr style="cursor: pointer;" onclick="showShowDetail(${s.id})">
                                <td>${escapeHtml(s.name)}</td>
                                <td style="text-align: right;">${s.matched_episodes}</td>
                                <td style="text-align: right;">${s.disk_files}</td>
                                <td style="text-align: right;"><span class="badge badge-warning">${s.extra}</span></td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            </div>
        </div>
    `;
}
