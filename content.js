/**
 * Content Script - runs in isolated extension world (ISOLATED)
 * Communicates with injected.js (MAIN world) via postMessage
 */

(function () {
  'use strict';

  let activeRules = [];

  // ======== Send Rules to Injected Script (MAIN world) ========
  function sendRulesToPage(rules) {
    activeRules = rules;
    window.postMessage({
      type: 'MOCK_RULES_UPDATE',
      rules: rules
    }, '*');
  }

  // ======== Load Rules from Storage ========
  function loadAndSendRules() {
    chrome.storage.local.get(['mockRules', 'projects'], function (result) {
      const projects = result.projects || [];
      const enabledProjectIds = projects
        .filter(p => p.enabled !== false)
        .map(p => p.id);
      
      const rules = (result.mockRules || []).filter(r => 
        r.enabled && enabledProjectIds.includes(r.projectId)
      );
      
      sendRulesToPage(rules);
    });
  }

  // ======== Update Hit Counter ========
  function incrementHitCounter(ruleId) {
    chrome.storage.local.get(['hitCounters'], function (result) {
      const counters = result.hitCounters || {};
      counters[ruleId] = (counters[ruleId] || 0) + 1;
      
      chrome.storage.local.set({ hitCounters: counters }, function () {
        // Notify popup of change
        chrome.runtime.sendMessage({
          type: 'HIT_COUNTER_UPDATED',
          ruleId: ruleId,
          count: counters[ruleId]
        }).catch(() => {
          // Popup may be closed, ignore error
        });
        
        // Notify background to flash badge
        chrome.runtime.sendMessage({ type: 'MOCK_HIT' }).catch(() => {});
      });
    });
  }

  // ======== Reset Counters ========
  function resetHitCounters() {
    chrome.storage.local.set({ hitCounters: {} });
  }

  // ======== Listen for Messages from Injected Script (MAIN world) ========
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;

    switch (event.data.type) {
      case 'MOCK_HIT':
        incrementHitCounter(event.data.ruleId);
        break;

      case 'MOCK_RULES_REQUEST':
        loadAndSendRules();
        break;
    }
  });

  // ======== Listen for Storage Changes ========
  chrome.storage.onChanged.addListener(function (changes, namespace) {
    if (namespace === 'local') {
      if (changes.mockRules || changes.projects) {
        loadAndSendRules();
      }
    }
  });

  // ======== Listen for Messages from Popup ========
  chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
    switch (message.type) {
      case 'GET_HIT_COUNTERS':
        chrome.storage.local.get(['hitCounters'], function (result) {
          sendResponse({ counters: result.hitCounters || {} });
        });
        return true; // Async response

      case 'RESET_HIT_COUNTERS':
        resetHitCounters();
        sendResponse({ success: true });
        break;

      case 'REFRESH_RULES':
        loadAndSendRules();
        sendResponse({ success: true });
        break;

      case 'UPDATE_ACTIVE_RULES':
        sendRulesToPage(message.rules);
        sendResponse({ success: true });
        break;
    }
  });

  // ======== Initialization ========
  loadAndSendRules();

  console.log('[qk-api-mock] Content script loaded (ISOLATED world)');
})();
