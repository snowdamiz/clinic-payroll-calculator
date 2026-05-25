const SIDE_PANEL_PATH = "sidepanel.html";

chrome.runtime.onInstalled.addListener(configureSidePanel);
chrome.runtime.onStartup.addListener(configureSidePanel);

configureSidePanel();

async function configureSidePanel() {
  try {
    await chrome.sidePanel.setOptions({
      path: SIDE_PANEL_PATH,
      enabled: true,
    });
    await chrome.sidePanel.setPanelBehavior({
      openPanelOnActionClick: true,
    });
  } catch (error) {
    console.warn("Clinic Payroll side panel could not be configured.", error);
  }
}
