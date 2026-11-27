import { defineConfig } from 'wxt';
export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  manifest: { name: 'AgentSync', description: 'Local multi-agent development coordinator with a Local MCP Test bridge', permissions: ['sidePanel','scripting','activeTab','storage'], optional_permissions: ['clipboardWrite'], host_permissions: ['http://127.0.0.1:8765/*'], optional_host_permissions: ['https://api.github.com/*','https://chatgpt.com/*'], action: { default_title: 'Open AgentSync' }, minimum_chrome_version: '114' },
});
