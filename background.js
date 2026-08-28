/**
 * Background Service Worker
 * Handles badge notifications for triggered mocks
 */

(function () {
  'use strict';

  // Store hit counts per tab
  const tabHits = new Map();

  // ======== Badge Management ========
  function updateBadgeForTab(tabId, count) {
    const text = count > 0 ? String(Math.min(count, 99)) : '';
    chrome.action.setBadgeText({ text, tabId });
    chrome.action.setBadgeBackgroundColor({ color: '#EE4266', tabId });
    chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
  }

  function clearBadgeForTab(tabId) {
    chrome.action.setBadgeText({ text: '', tabId });
    tabHits.delete(tabId);
  }

  // ======== Increment Hit Count for Tab ========
  function incrementTabHit(tabId) {
    const currentCount = tabHits.get(tabId) || 0;
    const newCount = currentCount + 1;
    tabHits.set(tabId, newCount);
    updateBadgeForTab(tabId, newCount);
    
    // Flash effect
    flashBadge(tabId);
  }

  // ======== Flash Badge Effect ========
  let flashTimeouts = {};
  function flashBadge(tabId) {
    chrome.action.setBadgeBackgroundColor({ color: '#00D9FF', tabId });
    
    clearTimeout(flashTimeouts[tabId]);
    flashTimeouts[tabId] = setTimeout(() => {
      chrome.action.setBadgeBackgroundColor({ color: '#EE4266', tabId });
    }, 300);
  }

  // ======== Listen for Messages from Content ========
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'MOCK_HIT' && sender.tab) {
      incrementTabHit(sender.tab.id);
    }
  });

  // ======== Clear badge on tab update/reload ========
  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === 'loading') {
      clearBadgeForTab(tabId);
    }
  });

  // ======== Clear badge on tab close ========
  chrome.tabs.onRemoved.addListener(function (tabId) {
    tabHits.delete(tabId);
    delete flashTimeouts[tabId];
  });

  // ======== Clear all badges on browser startup ========
  chrome.runtime.onStartup.addListener(function () {
    tabHits.clear();
    flashTimeouts = {};
  });

  console.log('[qk-api-mock] Background service worker initialized');
})();
