const allowedHosts = ['https://api.github.com/*', 'https://chatgpt.com/*'];
function exactList(value, expected) {
  return Array.isArray(value) && value.every(v => typeof v === 'string') && JSON.stringify([...value].sort()) === JSON.stringify([...expected].sort());
}
export function auditManifest(manifest) {
  if (!manifest || typeof manifest !== 'object' || Array.isArray(manifest)) throw new Error('Invalid generated manifest.');
  const failures = [];
  if (manifest.manifest_version !== 3) failures.push('Expected Manifest V3');
  if (!exactList(manifest.permissions, ['sidePanel','scripting','activeTab'])) failures.push('Unexpected mandatory permissions');
  if (!exactList(manifest.host_permissions ?? [], [])) failures.push('Unexpected mandatory host access');
  if (!exactList(manifest.optional_permissions ?? [], ['clipboardWrite'])) failures.push('Unexpected optional API permissions');
  if (!exactList(manifest.optional_host_permissions, allowedHosts)) failures.push('Unexpected optional host access');
  if (!exactList(manifest.content_scripts ?? [], [])) failures.push('Content scripts are not permitted in this release');
  for (const key of ['externally_connectable', 'web_accessible_resources', 'sandbox', 'devtools_page', 'chrome_url_overrides', 'update_url']) {
    if (Object.hasOwn(manifest, key)) failures.push('Unexpected manifest key: ' + key);
  }
  if (!manifest.side_panel || typeof manifest.side_panel.default_path !== 'string' || !manifest.side_panel.default_path) failures.push('Missing side panel entrypoint');
  if (!manifest.background || typeof manifest.background.service_worker !== 'string' || !manifest.background.service_worker) failures.push('Missing background service worker');
  if (failures.length) throw new Error('Manifest audit failed: ' + failures.join('; '));
  return true;
}
