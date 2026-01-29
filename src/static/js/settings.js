/**
 * Media Admin - Settings (tabs, general/metadata/library, auto-save, folders, import)
 */

// Settings
async function renderSettings() {
    appContent.innerHTML = '<div class="loading"><div class="spinner"></div></div>';

    try {
        const [settings, folders] = await Promise.all([
            api('/settings'),
            api('/folders')
        ]);

        state.settings = settings;
        state.folders = folders;

        // Store original values for reset functionality
        state.originalSettings = { ...settings };

        const activeTab = state.activeSettingsTab;

        appContent.innerHTML = `
            <div class="page-header">
                <h1 class="page-title">Settings</h1>
            </div>
            <div class="settings-tabs">
                <button class="settings-tab ${activeTab === 'general' ? 'active' : ''}" onclick="switchSettingsTab('general')">General</button>
                <button class="settings-tab ${activeTab === 'metadata' ? 'active' : ''}" onclick="switchSettingsTab('metadata')">Metadata</button>
                <button class="settings-tab ${activeTab === 'library' ? 'active' : ''}" onclick="switchSettingsTab('library')">Library</button>
                <button class="settings-tab ${activeTab === 'watcher' ? 'active' : ''}" onclick="switchSettingsTab('watcher')">Media Watcher</button>
            </div>
            <div id="settings-tab-content"></div>
        `;

        renderSettingsTabContent(activeTab);
    } catch (error) {
        appContent.innerHTML = `<div class="alert alert-danger">Failed to load settings.</div>`;
    }
}

function switchSettingsTab(tabName) {
    if (tabName === state.activeSettingsTab) return;
    applySettingsTab(tabName);
}

function applySettingsTab(tabName) {
    state.activeSettingsTab = tabName;
    localStorage.setItem('settingsActiveTab', tabName);

    // Update active class on tab buttons
    document.querySelectorAll('.settings-tab').forEach(btn => {
        const btnTab = btn.getAttribute('onclick').match(/switchSettingsTab\('(\w+)'\)/)?.[1];
        btn.classList.toggle('active', btnTab === tabName);
    });

    renderSettingsTabContent(tabName);
}

function renderSettingsTabContent(tabName) {
    const container = document.getElementById('settings-tab-content');
    if (!container) return;

    switch (tabName) {
        case 'general':
            container.innerHTML = renderSettingsGeneral(state.settings);
            break;
        case 'metadata':
            container.innerHTML = renderSettingsMetadata(state.settings);
            break;
        case 'library':
            container.innerHTML = renderSettingsLibrary(state.settings, state.folders);
            break;
        case 'watcher':
            container.innerHTML = renderSettingsWatcher();
            break;
        default:
            container.innerHTML = renderSettingsGeneral(state.settings);
    }

    updateFormatPreviews();
}

function renderSettingsGeneral(settings) {
    const currentTheme = settings.theme || 'midnight';
    return `
        <div class="card">
            <h2 class="card-title mb-20">Appearance</h2>
            <div class="theme-selector">
                <div class="theme-option ${currentTheme === 'midnight' ? 'active' : ''}" data-theme="midnight" onclick="updateTheme('midnight')">
                    <div class="theme-preview">
                        <div class="theme-swatch" style="background: #1a1a2e;"></div>
                        <div class="theme-swatch" style="background: #252542;"></div>
                        <div class="theme-swatch" style="background: #3498db;"></div>
                    </div>
                    <div class="theme-name">Midnight</div>
                </div>
                <div class="theme-option ${currentTheme === 'dark' ? 'active' : ''}" data-theme="dark" onclick="updateTheme('dark')">
                    <div class="theme-preview">
                        <div class="theme-swatch" style="background: #0a0a0a;"></div>
                        <div class="theme-swatch" style="background: #111111;"></div>
                        <div class="theme-swatch" style="background: #e67e22;"></div>
                    </div>
                    <div class="theme-name">OLED Dark</div>
                </div>
                <div class="theme-option ${currentTheme === 'light' ? 'active' : ''}" data-theme="light" onclick="updateTheme('light')">
                    <div class="theme-preview">
                        <div class="theme-swatch" style="background: #f5f5f5;"></div>
                        <div class="theme-swatch" style="background: #ffffff;"></div>
                        <div class="theme-swatch" style="background: #3498db;"></div>
                    </div>
                    <div class="theme-name">Light</div>
                </div>
            </div>
        </div>

        <div class="card">
            <h2 class="card-title mb-20">Dashboard Display</h2>
            <div class="dashboard-settings-grid">
                <div class="dashboard-setting-item">
                    <label>Upcoming Episodes</label>
                    <select id="settings-upcoming-days" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.upcoming_days, '{n} Days ahead')}
                    </select>
                </div>
                <div class="dashboard-setting-item">
                    <label>Recently Aired</label>
                    <select id="settings-recently-aired-days" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.recently_aired_days, '{n} Days back')}
                    </select>
                </div>
                <div class="dashboard-setting-item">
                    <label>Recently Added</label>
                    <select id="settings-recently-added-count" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.recently_added_count, '{n} Shows')}
                    </select>
                </div>
                <div class="dashboard-setting-item">
                    <label>Recently Matched</label>
                    <select id="settings-recently-matched-count" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.recently_matched_count, '{n} Episodes')}
                    </select>
                </div>
                <div class="dashboard-setting-item">
                    <label>Returning Soon</label>
                    <select id="settings-returning-soon-count" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.returning_soon_count, '{n} Shows')}
                    </select>
                </div>
                <div class="dashboard-setting-item">
                    <label>Recently Ended</label>
                    <select id="settings-recently-ended-count" class="form-control" onchange="autoSaveDashboardSettings()">
                        ${generateSelectOptions(30, settings.recently_ended_count, '{n} Shows')}
                    </select>
                </div>

            </div>
            <div class="dashboard-settings-divider"></div>
            <div class="form-group">
                <label class="dashboard-setting-label">Episode Display Format</label>
                <input type="text" id="settings-display-episode-format" class="form-control" value="${escapeHtml(settings.display_episode_format)}" oninput="updateFormatPreviews()" onchange="autoSaveDashboardSettings()">
                <div class="format-preview">Preview: <strong id="preview-display-episode-format"></strong></div>
                <small class="text-muted">
                    Variables: <code>{season}</code>, <code>{episode}</code><br>
                    Add <code>:02d</code> for zero-padding (e.g., <code>{season:02d}</code> = 03, <code>{episode:02d}</code> = 04)
                </small>
            </div>
        </div>
    `;
}

function renderSettingsMetadata(settings) {
    return `
        <div class="card">
            <h2 class="card-title mb-20">Metadata Providers</h2>
            <div class="form-group">
                <label>Default Metadata Source</label>
                <div class="metadata-source-options">
                    <label>
                        <input type="radio" name="settings-default-source" value="tmdb" ${settings.default_metadata_source === 'tmdb' ? 'checked' : ''} onchange="updateDefaultMetadataSource(this.value)">
                        TMDB
                    </label>
                    <label>
                        <input type="radio" name="settings-default-source" value="tvdb" ${settings.default_metadata_source === 'tvdb' ? 'checked' : ''} onchange="updateDefaultMetadataSource(this.value)">
                        TVDB
                    </label>
                </div>
                <small class="text-muted">Used for new shows, Managed Import, and search default</small>
            </div>
            <div class="form-group" style="margin-top: 20px;">
                <label>TMDB API Key ${settings.tmdb_api_key_set ? '<span class="badge badge-success">Set</span>' : '<span class="badge badge-danger">Not Set</span>'}</label>
                <small class="text-muted">Metadata provided by <a href="https://www.themoviedb.org" target="_blank">The Movie Database (TMDB)</a></small>
                <input type="password" id="settings-api-key" class="form-control" placeholder="${settings.tmdb_api_key_set ? '••••••••' : 'Enter API key'}" onchange="autoSaveApiKey('tmdb')">
            </div>
            <div class="form-group" style="margin-top: 20px;">
                <label>TVDB API Key ${settings.tvdb_api_key_set ? '<span class="badge badge-success">Set</span>' : '<span class="badge badge-danger">Not Set</span>'}</label>
                <small class="text-muted">Metadata provided by <a href="https://thetvdb.com" target="_blank">TheTVDB</a></small>
                <input type="password" id="settings-tvdb-api-key" class="form-control" placeholder="${settings.tvdb_api_key_set ? '••••••••' : 'Enter API key'}" onchange="autoSaveApiKey('tvdb')">
            </div>
        </div>
    `;
}

function renderSettingsLibrary(settings, folders) {
    const libraryFolders = folders.filter(f => f.type === 'library');
    const downloadFolders = folders.filter(f => f.type === 'download');

    return `
        <div class="card">
            <h2 class="card-title mb-20">Naming Formats</h2>
            <div class="form-group">
                <label>Episode Filename Format</label>
                <input type="text" id="settings-episode-format" class="form-control" value="${escapeHtml(settings.episode_format)}" oninput="updateFormatPreviews()" onchange="autoSaveFormats()">
                <div class="format-preview">Preview: <strong id="preview-episode-format"></strong></div>
                <small class="text-muted">
                    Variables: <code>{season}</code>, <code>{episode}</code>, <code>{title}</code><br>
                    Add <code>:02d</code> for zero-padding (e.g., <code>{episode:02d}</code> = 04 instead of 4)
                </small>
            </div>
            <div class="form-group">
                <label>Season Folder Format</label>
                <input type="text" id="settings-season-format" class="form-control" value="${escapeHtml(settings.season_format)}" oninput="updateFormatPreviews()" onchange="autoSaveFormats()">
                <div class="format-preview">Preview: <strong id="preview-season-format"></strong></div>
                <small class="text-muted">
                    Variables: <code>{season}</code><br>
                    Add <code>:02d</code> for zero-padding (e.g., <code>{season:02d}</code> = 04 instead of 4)
                </small>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Library Folders</h2>
                <button class="btn btn-sm btn-primary" onclick="showAddFolderModal('library')">+ Add Folder</button>
            </div>
            ${libraryFolders.length === 0 ? `
                <p class="text-muted" id="library-folders-placeholder">No library folders configured.</p>
            ` : `
                <table id="library-folders-table">
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${libraryFolders.map(folder => `
                            <tr data-folder-id="${folder.id}">
                                <td>${escapeHtml(folder.path)}</td>
                                <td class="folder-status"><span class="badge ${folder.enabled ? 'badge-success' : 'badge-warning'}">${folder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-primary" onclick="scanLibraryFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Scan</button>
                                    <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${folder.id})">${folder.enabled ? 'Disable' : 'Enable'}</button>
                                    <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Remove</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `}
            <div style="padding: 15px 15px 5px; border-top: 1px solid var(--border-color); margin-top: 10px;">
                <div class="form-group" style="max-width: 250px; margin-bottom: 10px;">
                    <label>Managed Import Count</label>
                    <input type="number" id="settings-slow-import-count" class="form-control" value="${settings.slow_import_count || 10}" min="1" max="500" onchange="autoSaveSlowImportCount()">
                    <small class="text-muted">Number of shows to import per managed import batch. Uses the default metadata source (${settings.default_metadata_source?.toUpperCase() || 'TMDB'}) selected above.</small>
                </div>
            </div>
        </div>

        <div class="card">
            <div class="card-header">
                <h2 class="card-title">Download Folders</h2>
                <button class="btn btn-sm btn-primary" onclick="showAddFolderModal('download')">+ Add Folder</button>
            </div>
            ${downloadFolders.length === 0 ? `
                <p class="text-muted" id="download-folders-placeholder">No download folders configured.</p>
            ` : `
                <table id="download-folders-table">
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${downloadFolders.map(folder => `
                            <tr data-folder-id="${folder.id}">
                                <td>${escapeHtml(folder.path)}</td>
                                <td class="folder-status"><span class="badge ${folder.enabled ? 'badge-success' : 'badge-warning'}">${folder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                                <td>
                                    <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${folder.id})">${folder.enabled ? 'Disable' : 'Enable'}</button>
                                    <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${folder.id}, '${escapeHtml(folder.path).replace(/'/g, "\\'")}')">Remove</button>
                                </td>
                            </tr>
                        `).join('')}
                    </tbody>
                </table>
            `}
        </div>
    `;
}

function updateFormatPreviews() {
    // Sample data for previews
    const sampleSeason = 3;
    const sampleEpisode = 4;
    const sampleTitle = "The One Where They Code";

    // Helper to apply format
    const applyFormat = (format, vars) => {
        let result = format;
        for (const [key, value] of Object.entries(vars)) {
            // Handle :02d padding
            result = result.replace(new RegExp(`\\{${key}:02d\\}`, 'g'), String(value).padStart(2, '0'));
            result = result.replace(new RegExp(`\\{${key}:03d\\}`, 'g'), String(value).padStart(3, '0'));
            // Handle plain variable
            result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), value);
        }
        return result;
    };

    // Episode format preview
    const episodeFormatInput = document.getElementById('settings-episode-format');
    const episodePreview = document.getElementById('preview-episode-format');
    if (episodeFormatInput && episodePreview) {
        const format = episodeFormatInput.value || '{season}x{episode:02d} - {title}';
        episodePreview.textContent = applyFormat(format, {
            season: sampleSeason,
            episode: sampleEpisode,
            title: sampleTitle
        });
    }

    // Season folder format preview
    const seasonFormatInput = document.getElementById('settings-season-format');
    const seasonPreview = document.getElementById('preview-season-format');
    if (seasonFormatInput && seasonPreview) {
        const format = seasonFormatInput.value || 'Season {season}';
        seasonPreview.textContent = applyFormat(format, {
            season: sampleSeason
        });
    }

    // Episode display format preview
    const displayFormatInput = document.getElementById('settings-display-episode-format');
    const displayPreview = document.getElementById('preview-display-episode-format');
    if (displayFormatInput && displayPreview) {
        const format = displayFormatInput.value || '{season}x{episode:02d}';
        displayPreview.textContent = applyFormat(format, {
            season: sampleSeason,
            episode: sampleEpisode
        });
    }
}

async function autoSaveApiKey(provider) {
    const inputId = provider === 'tmdb' ? 'settings-api-key' : 'settings-tvdb-api-key';
    const bodyKey = provider === 'tmdb' ? 'tmdb_api_key' : 'tvdb_api_key';
    const apiKey = document.getElementById(inputId)?.value.trim();
    if (!apiKey) return;

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ [bodyKey]: apiKey })
        });
        showToast(`${provider.toUpperCase()} API key updated`, 'success');
        renderSettings();
    } catch (error) {
        // Error already shown
    }
}

async function autoSaveFormats() {
    const episodeFormat = document.getElementById('settings-episode-format')?.value.trim();
    const seasonFormat = document.getElementById('settings-season-format')?.value.trim();
    if (!episodeFormat || !seasonFormat) return;

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ episode_format: episodeFormat, season_format: seasonFormat })
        });
        state.settings.episode_format = episodeFormat;
        state.settings.season_format = seasonFormat;
    } catch (error) {
        // Error already shown
    }
}

async function autoSaveDashboardSettings() {
    const data = {};
    const el = (id) => document.getElementById(id);

    if (el('settings-upcoming-days')) data.upcoming_days = parseInt(el('settings-upcoming-days').value);
    if (el('settings-recently-aired-days')) data.recently_aired_days = parseInt(el('settings-recently-aired-days').value);
    if (el('settings-recently-added-count')) data.recently_added_count = parseInt(el('settings-recently-added-count').value);
    if (el('settings-recently-matched-count')) data.recently_matched_count = parseInt(el('settings-recently-matched-count').value);
    if (el('settings-returning-soon-count')) data.returning_soon_count = parseInt(el('settings-returning-soon-count').value);
    if (el('settings-recently-ended-count')) data.recently_ended_count = parseInt(el('settings-recently-ended-count').value);
    if (el('settings-display-episode-format')) data.display_episode_format = el('settings-display-episode-format').value.trim();


    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify(data)
        });
        Object.assign(state.settings, data);
    } catch (error) {
        // Error already shown
    }
}

async function autoSaveSlowImportCount() {
    const val = parseInt(document.getElementById('settings-slow-import-count')?.value) || 10;
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ slow_import_count: val })
        });
    } catch (error) {
        // Error already shown
    }
}

async function updateApiKey() {
    const apiKey = document.getElementById('settings-api-key').value.trim();
    if (!apiKey) {
        showToast('Please enter an API key', 'warning');
        return;
    }

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ tmdb_api_key: apiKey })
        });
        showToast('TMDB API key updated', 'success');
        renderSettings();
    } catch (error) {
        // Error already shown
    }
}

async function updateTvdbApiKey() {
    const apiKey = document.getElementById('settings-tvdb-api-key').value.trim();
    if (!apiKey) {
        showToast('Please enter an API key', 'warning');
        return;
    }

    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ tvdb_api_key: apiKey })
        });
        showToast('TVDB API key updated', 'success');
        renderSettings();
    } catch (error) {
        // Error already shown
    }
}

async function updateDefaultMetadataSource(source) {
    try {
        await api('/settings', {
            method: 'PUT',
            body: JSON.stringify({ default_metadata_source: source })
        });
        state.settings.default_metadata_source = source;
        initSearchSourceToggle();
        showToast(`Default metadata source set to ${source.toUpperCase()}`, 'success');
    } catch (error) {
        // Error already shown
    }
}

// Legacy save functions kept for any remaining callers
async function updateFormats() { await autoSaveFormats(); }
async function updateDashboardSettings() { await autoSaveDashboardSettings(); }
async function updateSlowImportCount() { await autoSaveSlowImportCount(); }

function showAddFolderModal(folderType) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = `Add ${folderType === 'library' ? 'Library' : 'Download'} Folder`;
    modalBody.innerHTML = `
        <div class="form-group">
            <label>Folder Path</label>
            <input type="text" id="new-folder-path" class="form-control" placeholder="/path/to/folder">
        </div>
        <button class="btn btn-primary" onclick="addFolder('${folderType}')">Add Folder</button>
    `;

    modal.classList.add('active');
}

async function addFolder(folderType) {
    const path = document.getElementById('new-folder-path').value.trim();
    if (!path) {
        showToast('Please enter a folder path', 'warning');
        return;
    }

    try {
        const newFolder = await api('/folders', {
            method: 'POST',
            body: JSON.stringify({ path, type: folderType })
        });

        // Close modal first so user sees immediate feedback
        closeModal();

        // Add to state
        state.folders.push(newFolder);

        // Find the appropriate table or placeholder
        const tableId = folderType === 'library' ? 'library-folders-table' : 'download-folders-table';
        const placeholderId = folderType === 'library' ? 'library-folders-placeholder' : 'download-folders-placeholder';
        let table = document.getElementById(tableId);
        let placeholder = document.getElementById(placeholderId);

        // Create the new row HTML
        const newRowHtml = `
            <tr data-folder-id="${newFolder.id}">
                <td>${escapeHtml(newFolder.path)}</td>
                <td class="folder-status"><span class="badge ${newFolder.enabled ? 'badge-success' : 'badge-warning'}">${newFolder.enabled ? 'Enabled' : 'Disabled'}</span></td>
                <td>
                    <button class="btn btn-sm btn-secondary folder-toggle-btn" onclick="toggleFolder(${newFolder.id})">${newFolder.enabled ? 'Disable' : 'Enable'}</button>
                    <button class="btn btn-sm btn-danger" onclick="confirmDeleteFolder(${newFolder.id}, '${escapeHtml(newFolder.path).replace(/'/g, "\\'")}')">Remove</button>
                </td>
            </tr>
        `;

        if (table) {
            // Table exists, add the new row
            table.querySelector('tbody').insertAdjacentHTML('beforeend', newRowHtml);
        } else if (placeholder) {
            // No table yet, create it replacing the placeholder
            const tableHtml = `
                <table id="${tableId}">
                    <thead>
                        <tr>
                            <th>Path</th>
                            <th>Status</th>
                            <th>Actions</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${newRowHtml}
                    </tbody>
                </table>
            `;
            placeholder.outerHTML = tableHtml;
        }

        showToast('Folder added', 'success');
    } catch (error) {
        // Error already shown
    }
}

async function toggleFolder(folderId) {
    try {
        const updatedFolder = await api(`/folders/${folderId}/toggle`, { method: 'PUT' });

        // Update the folder in state
        const folderIndex = state.folders.findIndex(f => f.id === folderId);
        if (folderIndex !== -1) {
            state.folders[folderIndex] = updatedFolder;
        }

        // Update just the row in the table
        const row = document.querySelector(`tr[data-folder-id="${folderId}"]`);
        if (row) {
            const statusCell = row.querySelector('.folder-status');
            const toggleBtn = row.querySelector('.folder-toggle-btn');

            if (statusCell) {
                statusCell.innerHTML = `<span class="badge ${updatedFolder.enabled ? 'badge-success' : 'badge-warning'}">${updatedFolder.enabled ? 'Enabled' : 'Disabled'}</span>`;
            }
            if (toggleBtn) {
                toggleBtn.textContent = updatedFolder.enabled ? 'Disable' : 'Enable';
            }
        }

        showToast(`Folder ${updatedFolder.enabled ? 'enabled' : 'disabled'}`, 'success');
    } catch (error) {
        // Error already shown
    }
}

function confirmDeleteFolder(folderId, folderPath) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Remove Folder';
    modalBody.innerHTML = `
        <p>Are you sure you want to remove this folder?</p>
        <p class="text-muted" style="word-break: break-all;">${escapeHtml(folderPath)}</p>
        <div class="modal-buttons">
            <button class="btn btn-danger" onclick="deleteFolder(${folderId})">Remove</button>
            <button class="btn btn-secondary" onclick="closeModal()">Cancel</button>
        </div>
    `;

    modal.classList.add('active');
}

async function deleteFolder(folderId) {
    try {
        await api(`/folders/${folderId}`, { method: 'DELETE' });

        // Remove from state
        state.folders = state.folders.filter(f => f.id !== folderId);

        // Remove the row from the table
        const row = document.querySelector(`tr[data-folder-id="${folderId}"]`);
        if (row) {
            row.remove();
        }

        // Check if the table is now empty and show "No folders" message
        const libraryTable = document.getElementById('library-folders-table');
        const downloadTable = document.getElementById('download-folders-table');

        if (libraryTable && libraryTable.querySelectorAll('tbody tr').length === 0) {
            libraryTable.outerHTML = '<p class="text-muted" id="library-folders-placeholder">No library folders configured.</p>';
        }
        if (downloadTable && downloadTable.querySelectorAll('tbody tr').length === 0) {
            downloadTable.outerHTML = '<p class="text-muted" id="download-folders-placeholder">No download folders configured.</p>';
        }

        closeModal();
        showToast('Folder removed', 'success');
    } catch (error) {
        // Error already shown
    }
}

// Managed Import - import a configured number of shows from library folder
async function startSlowImport() {
    try {
        // Fetch settings and folders
        const [settings, folders] = await Promise.all([
            api('/settings'),
            api('/folders')
        ]);

        const slowImportCount = settings.slow_import_count || 10;
        const libraryFolders = folders.filter(f => f.type === 'library' && f.enabled);

        if (libraryFolders.length === 0) {
            showToast('No library folders configured. Add one in Settings.', 'warning');
            return;
        }

        const folder = libraryFolders[0];
        showLibraryFolderScanModal(folder.path);

        // Start scan with limit
        await api('/scan/library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_id: folder.id, limit: slowImportCount })
        });

        pollLibraryFolderScanStatus();
    } catch (error) {
        closeLibraryFolderScanModal();
        // Error already shown by api()
    }
}

// Library Folder Discovery Scan
async function scanLibraryFolder(folderId, folderPath) {
    // Show the scanning modal
    showLibraryFolderScanModal(folderPath);

    try {
        // Start the scan
        await api('/scan/library-folder', {
            method: 'POST',
            body: JSON.stringify({ folder_id: folderId })
        });

        // Poll for status updates
        pollLibraryFolderScanStatus();
    } catch (error) {
        closeLibraryFolderScanModal();
        // Error already shown by api()
    }
}

function showLibraryFolderScanModal(folderPath) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    modalTitle.textContent = 'Scanning Library Folder';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-header">
                <div class="library-scan-folder" title="${escapeHtml(folderPath)}">${escapeHtml(folderPath)}</div>
                <div class="library-scan-status">
                    <div class="library-scan-spinner"></div>
                    <span id="library-scan-message">Initializing...</span>
                </div>
                <div class="library-scan-progress-container">
                    <div class="library-scan-progress-bar" id="library-scan-progress" style="width: 0%"></div>
                </div>
            </div>
            <div class="library-scan-stats" id="library-scan-stats">
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-found">0</span>
                    <span class="library-scan-stat-label">Found</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-added">0</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-skipped">0</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value" id="stat-matched">0</span>
                    <span class="library-scan-stat-label">Episodes</span>
                </div>
            </div>
            <div class="library-scan-current" id="library-scan-current"></div>
            <div class="library-scan-console" id="library-scan-console">
                <div class="console-placeholder">Waiting for scan to start...</div>
            </div>
        </div>
    `;

    // Hide close button during scan
    document.querySelector('.modal-close').style.display = 'none';
    modal.classList.add('active');
}

function updateLibraryFolderScanModal(status) {
    // Update message
    const messageEl = document.getElementById('library-scan-message');
    if (messageEl) messageEl.textContent = status.message || 'Scanning...';

    // Update progress bar
    const progressEl = document.getElementById('library-scan-progress');
    if (progressEl) progressEl.style.width = `${status.progress || 0}%`;

    // Update stats
    const statFound = document.getElementById('stat-found');
    const statAdded = document.getElementById('stat-added');
    const statSkipped = document.getElementById('stat-skipped');
    const statMatched = document.getElementById('stat-matched');

    if (statFound) statFound.textContent = status.shows_found || 0;
    if (statAdded) statAdded.textContent = status.shows_added || 0;
    if (statSkipped) statSkipped.textContent = status.shows_skipped || 0;
    if (statMatched) statMatched.textContent = status.episodes_matched || 0;

    // Update current show
    const currentEl = document.getElementById('library-scan-current');
    if (currentEl) {
        if (status.current_show) {
            currentEl.textContent = `Processing: ${status.current_show}`;
            currentEl.style.display = 'block';
        } else {
            currentEl.style.display = 'none';
        }
    }

    // Update console
    const consoleEl = document.getElementById('library-scan-console');
    if (consoleEl && status.console && status.console.length > 0) {
        const entries = status.console.map(entry => {
            let levelClass = '';
            let icon = '';
            switch (entry.level) {
                case 'error':
                    levelClass = 'console-error';
                    icon = '✗';
                    break;
                case 'warning':
                    levelClass = 'console-warning';
                    icon = '⚠';
                    break;
                case 'success':
                    levelClass = 'console-success';
                    icon = '✓';
                    break;
                case 'skip':
                    levelClass = 'console-skip';
                    icon = '→';
                    break;
                default:
                    levelClass = 'console-info';
                    icon = '•';
            }
            return `<div class="console-entry ${levelClass}">
                <span class="console-time">${entry.time}</span>
                <span class="console-icon">${icon}</span>
                <span class="console-message">${escapeHtml(entry.message)}</span>
            </div>`;
        }).join('');

        consoleEl.innerHTML = entries;
        // Auto-scroll to bottom
        consoleEl.scrollTop = consoleEl.scrollHeight;
    }
}

function closeLibraryFolderScanModal() {
    document.querySelector('.modal-close').style.display = '';
    closeModal();
}

// Store last scan status so minimized results can be restored
let _lastScanCompleteStatus = null;

function showLibraryFolderScanComplete(status) {
    _lastScanCompleteStatus = status;
    _renderScanCompleteModal(status);
    // Remove minimized indicator if present
    const indicator = document.getElementById('scan-results-indicator');
    if (indicator) indicator.remove();
}

function _renderScanCompleteModal(status) {
    const modal = document.getElementById('modal');
    const modalBody = document.getElementById('modal-body');
    const modalTitle = document.getElementById('modal-title');

    const result = status.result || {};
    const showsProcessed = result.shows_processed || [];

    // Status icon/color helpers
    const statusDisplay = (show) => {
        if (show.status === 'added') {
            // Green check only if all episodes matched, red X if any missing
            if (show.total_episodes > 0 && show.episodes_matched < show.total_episodes) {
                return { icon: '✗', cls: 'console-error', label: 'Added (missing episodes)' };
            }
            return { icon: '✓', cls: 'console-success', label: 'Added' };
        }
        switch (show.status) {
            case 'existing': return { icon: '→', cls: 'console-skip', label: 'Existing' };
            case 'not_found': return { icon: '⚠', cls: 'console-warning', label: 'Not Found' };
            case 'error': return { icon: '✗', cls: 'console-error', label: 'Error' };
            default: return { icon: '•', cls: 'console-info', label: show.status };
        }
    };

    const allClean = showsProcessed.length > 0 &&
        showsProcessed.every(show => statusDisplay(show).cls !== 'console-error');

    modalTitle.textContent = 'Scan Complete';
    modalBody.innerHTML = `
        <div class="library-scan-modal">
            <div class="library-scan-complete-stats">
                <div class="library-scan-stat ${result.shows_added > 0 ? 'stat-highlight' : ''}">
                    <span class="library-scan-stat-value">${result.shows_added || 0}</span>
                    <span class="library-scan-stat-label">Added</span>
                </div>
                <div class="library-scan-stat">
                    <span class="library-scan-stat-value">${result.shows_skipped || 0}</span>
                    <span class="library-scan-stat-label">Skipped</span>
                </div>
                <div class="library-scan-stat ${result.episodes_matched > 0 ? 'stat-highlight' : ''}">
                    <span class="library-scan-stat-value">${result.episodes_matched || 0}</span>
                    <span class="library-scan-stat-label">Episodes</span>
                </div>
            </div>
            ${showsProcessed.length > 0 ? `
                <div class="table-container" style="max-height: 300px; overflow-y: auto; border: 1px solid var(--border-color); border-radius: 8px;">
                    <table style="font-size: 0.85rem;">
                        <thead>
                            <tr>
                                <th style="width: 30px;"></th>
                                <th>Show</th>
                                <th>Episodes</th>
                                <th>Detail</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${showsProcessed.map(show => {
                                const sd = statusDisplay(show);
                                return `<tr>
                                    <td class="${sd.cls}" style="text-align: center; font-weight: bold;">${sd.icon}</td>
                                    <td>${escapeHtml(show.name)}</td>
                                    <td style="text-align: center;">${show.status === 'added' || show.episodes_matched > 0 ? show.episodes_matched : '—'}</td>
                                    <td class="text-muted" style="font-size: 0.8rem;">${escapeHtml(show.detail || sd.label)}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>
            ` : ''}
            <div class="library-scan-actions">
                ${allClean
                    ? `<button class="btn btn-primary" onclick="continueImport();">Continue Import</button>`
                    : `<button class="btn btn-primary" disabled style="opacity: 0.5; cursor: not-allowed;">Continue Import</button>`
                }
                <button class="btn btn-primary" onclick="closeModal(); renderShowsList();">View Shows</button>
                <button class="btn btn-secondary" onclick="minimizeScanResults();">Minimize</button>
                <button class="btn btn-secondary" onclick="dismissScanResults(); closeModal();">Close</button>
            </div>
        </div>
    `;

    document.querySelector('.modal-close').style.display = '';
    modal.classList.add('active');
}

function minimizeScanResults() {
    closeModal();
    renderShowsList();

    // Don't add duplicate indicator
    if (document.getElementById('scan-results-indicator')) return;

    // Add indicator to sidebar
    const nav = document.querySelector('.nav-menu');
    const li = document.createElement('li');
    li.id = 'scan-results-indicator';
    li.innerHTML = `
        <a href="#" onclick="restoreScanResults(); return false;" style="color: var(--success-color);">
            <span class="nav-icon">&#x1F4CB;</span>
            Import Results
        </a>
    `;
    nav.appendChild(li);
}

function restoreScanResults() {
    if (_lastScanCompleteStatus) {
        _renderScanCompleteModal(_lastScanCompleteStatus);
    }
}

function dismissScanResults() {
    _lastScanCompleteStatus = null;
    const indicator = document.getElementById('scan-results-indicator');
    if (indicator) indicator.remove();
}

async function continueImport() {
    closeModal();
    dismissScanResults();
    startSlowImport();
}

let libraryFolderScanPollTimer = null;

function pollLibraryFolderScanStatus() {
    const checkStatus = async () => {
        try {
            const status = await fetch(`${API_BASE}/scan/library-folder/status`).then(r => r.json());

            if (status.running) {
                updateLibraryFolderScanModal(status);
                libraryFolderScanPollTimer = setTimeout(checkStatus, 500);
            } else {
                // Scan complete
                updateLibraryFolderScanModal(status);

                // Short delay to show final state
                setTimeout(() => {
                    if (status.result && !status.result.error) {
                        showLibraryFolderScanComplete(status);
                    } else {
                        closeLibraryFolderScanModal();
                        if (status.result?.error) {
                            showToast(`Scan failed: ${status.result.error}`, 'error');
                        }
                    }
                }, 1000);
            }
        } catch (error) {
            closeLibraryFolderScanModal();
            showToast('Failed to get scan status', 'error');
        }
    };

    // Start polling
    libraryFolderScanPollTimer = setTimeout(checkStatus, 300);
}
