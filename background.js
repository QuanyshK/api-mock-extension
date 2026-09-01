(function () {
  'use strict';

  const tabHits = new Map();
  const activeTabs = new Set();
  const flashTimeouts = {};

  try {
    chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
  } catch (e) {}

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

  function incrementTabHit(tabId) {
    const currentCount = tabHits.get(tabId) || 0;
    const newCount = currentCount + 1;
    tabHits.set(tabId, newCount);
    updateBadgeForTab(tabId, newCount);

    flashBadge(tabId);
  }

  function flashBadge(tabId) {
    chrome.action.setBadgeBackgroundColor({ color: '#00D9FF', tabId });

    clearTimeout(flashTimeouts[tabId]);
    flashTimeouts[tabId] = setTimeout(() => {
      chrome.action.setBadgeBackgroundColor({ color: '#EE4266', tabId });
    }, 300);
  }

  function setTabEnabled(tabId, enabled) {
    if (enabled) {
      activeTabs.add(tabId);
      chrome.action.setBadgeText({ text: 'ON', tabId });
      chrome.action.setBadgeBackgroundColor({ color: '#4CAF50', tabId });
      chrome.action.setBadgeTextColor({ color: '#FFFFFF', tabId });
    } else {
      activeTabs.delete(tabId);
      chrome.action.setBadgeText({ text: '', tabId });
    }
  }

  function restoreBadgeForTab(tabId) {
    chrome.storage.session.get(['tabEnabledStatus'], function (result) {
      if (chrome.runtime.lastError) {
        return;
      }

      const status = result.tabEnabledStatus || {};
      const isEnabled = status[tabId] === true;

      setTabEnabled(tabId, isEnabled);
    });
  }

  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    if (message.type === 'MOCK_HIT' && sender.tab) {
      incrementTabHit(sender.tab.id);
    }
    if (message.type === 'SET_TAB_ENABLED') {
      setTabEnabled(message.tabId, message.enabled);
    }
    if (message.type === 'GET_TAB_ID' && sender.tab) {
      sendResponse({ tabId: sender.tab.id });
      return true;
    }
  });

  chrome.tabs.onUpdated.addListener(function (tabId, changeInfo, tab) {
    if (changeInfo.status === 'loading') {
      clearBadgeForTab(tabId);
      activeTabs.delete(tabId);
    }
    if (changeInfo.status === 'complete') {
      restoreBadgeForTab(tabId);
    }
  });

  chrome.tabs.onRemoved.addListener(function (tabId) {
    tabHits.delete(tabId);
    delete flashTimeouts[tabId];
    activeTabs.delete(tabId);

    chrome.storage.session.get(['tabEnabledStatus'], function (result) {
      if (chrome.runtime.lastError) return;
      const status = result.tabEnabledStatus || {};
      if (status[tabId]) {
        delete status[tabId];
        chrome.storage.session.set({ tabEnabledStatus: status });
      }
    });
  });

  chrome.runtime.onStartup.addListener(function () {
    tabHits.clear();
    activeTabs.clear();
    for (const key in flashTimeouts) {
      delete flashTimeouts[key];
    }

    try {
      chrome.storage.session.setAccessLevel({ accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS' });
    } catch (e) {}
  });
})();
