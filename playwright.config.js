// @ts-check
const { defineConfig } = require('@playwright/test');

module.exports = defineConfig({
  testDir: './tests',
  timeout: 180_000,       // 3 min por teste (importação com delays + criação de categoria)
  retries: 2,  // CloudFront pode bloquear na 1ª tentativa; tenta até 3x
  reporter: [['list'], ['html', { open: 'never' }]],
  use: {
    headless: false,      // extensões Chrome exigem modo não-headless
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chrome-extension',
      use: {
        browserName: 'chromium',
      },
    },
  ],
});
