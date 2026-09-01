(function () {
  'use strict';

  let activeRules = [];
  let isEnabled = false;
  let contextInvalidated = false;

  function isContextInvalidatedError(err) {
    return !!(err && err.message && err.message.indexOf('Extension context invalidated') !== -1);
  }

  function markContextInvalidated() {
    contextInvalidated = true;
  }

  function isExtensionContextValid() {
    if (contextInvalidated) return false;
    try {
      return !!(chrome.runtime && chrome.runtime.id);
    } catch (e) {
      markContextInvalidated();
      return false;
    }
  }

  function sendRulesToPage(rules, enabled) {
    activeRules = rules;
    if (typeof enabled === 'boolean') {
      isEnabled = enabled;
    }
    window.postMessage({
      type: 'MOCK_RULES_UPDATE',
      rules: isEnabled ? rules : [],
      isEnabled: isEnabled
    }, '*');
  }

  function loadAndSendRules() {
    if (!isExtensionContextValid()) return;

    try {
      chrome.storage.local.get(['mockRules', 'projects'], function (result) {
        if (chrome.runtime.lastError) {
          if (isContextInvalidatedError(chrome.runtime.lastError)) {
            markContextInvalidated();
          }
          return;
        }

        const projects = result.projects || [];
        const enabledProjectIds = projects
          .filter(p => p.enabled !== false)
          .map(p => p.id);

        const rules = (result.mockRules || []).filter(r =>
          r.enabled && enabledProjectIds.includes(r.projectId)
        );

        sendRulesToPage(rules, isEnabled);
      });
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        markContextInvalidated();
      }
    }
  }

  function restoreTabState() {
    if (!isExtensionContextValid()) {
      loadAndSendRules();
      return;
    }

    try {
      chrome.runtime.sendMessage({ type: 'GET_TAB_ID' }, function (response) {
        if (chrome.runtime.lastError || !response || !response.tabId) {
          loadAndSendRules();
          return;
        }

        const tabId = response.tabId;

        chrome.storage.session.get(['tabEnabledStatus'], function (result) {
          if (chrome.runtime.lastError) {
            loadAndSendRules();
            return;
          }

          const status = result.tabEnabledStatus || {};

          if (status[tabId] === true) {
            isEnabled = true;
            loadAndSendRules();

            try {
              chrome.runtime.sendMessage({
                type: 'SET_TAB_ENABLED',
                tabId: tabId,
                enabled: true
              });
            } catch (e) {}
          } else {
            loadAndSendRules();
          }
        });
      });
    } catch (e) {
      loadAndSendRules();
    }
  }

  function incrementHitCounter(ruleId) {
    if (!isExtensionContextValid()) return;

    try {
      chrome.storage.local.get(['hitCounters'], function (result) {
        if (chrome.runtime.lastError) {
          if (isContextInvalidatedError(chrome.runtime.lastError)) {
            markContextInvalidated();
          }
          return;
        }

        const counters = result.hitCounters || {};
        counters[ruleId] = (counters[ruleId] || 0) + 1;

        try {
          chrome.storage.local.set({ hitCounters: counters }, function () {
            if (chrome.runtime.lastError) {
              if (isContextInvalidatedError(chrome.runtime.lastError)) {
                markContextInvalidated();
              }
              return;
            }

            if (!isExtensionContextValid()) return;

            try {
              const msg1 = chrome.runtime.sendMessage({
                type: 'HIT_COUNTER_UPDATED',
                ruleId: ruleId,
                count: counters[ruleId]
              });
              if (msg1 && typeof msg1.catch === 'function') {
                msg1.catch(function () {});
              }

              const msg2 = chrome.runtime.sendMessage({ type: 'MOCK_HIT' });
              if (msg2 && typeof msg2.catch === 'function') {
                msg2.catch(function () {});
              }
            } catch (e) {
              if (isContextInvalidatedError(e)) {
                markContextInvalidated();
              }
            }
          });
        } catch (e) {
          if (isContextInvalidatedError(e)) {
            markContextInvalidated();
          }
        }
      });
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        markContextInvalidated();
      }
    }
  }

  function resetHitCounters() {
    if (!isExtensionContextValid()) return;

    try {
      chrome.storage.local.set({ hitCounters: {} }, function () {
        if (chrome.runtime.lastError && isContextInvalidatedError(chrome.runtime.lastError)) {
          markContextInvalidated();
        }
      });
    } catch (e) {
      if (isContextInvalidatedError(e)) {
        markContextInvalidated();
      }
    }
  }

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

  try {
    chrome.storage.onChanged.addListener(function (changes, namespace) {
      if (!isExtensionContextValid()) return;

      if (namespace === 'local') {
        if (changes.mockRules || changes.projects) {
          loadAndSendRules();
        }
      }
    });
  } catch (e) {
    if (isContextInvalidatedError(e)) {
      markContextInvalidated();
    }
  }

  try {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (!isExtensionContextValid()) {
        try {
          sendResponse({ error: 'Extension context invalidated' });
        } catch (e) {}
        return;
      }

      switch (message.type) {
        case 'GET_HIT_COUNTERS':
          try {
            chrome.storage.local.get(['hitCounters'], function (result) {
              if (chrome.runtime.lastError) {
                if (isContextInvalidatedError(chrome.runtime.lastError)) {
                  markContextInvalidated();
                }
                try {
                  sendResponse({ error: chrome.runtime.lastError.message });
                } catch (e) {}
                return;
              }
              try {
                sendResponse({ counters: result.hitCounters || {} });
              } catch (e) {}
            });
          } catch (e) {
            if (isContextInvalidatedError(e)) {
              markContextInvalidated();
            }
            try {
              sendResponse({ error: e.message });
            } catch (err) {}
          }
          return true;

        case 'RESET_HIT_COUNTERS':
          resetHitCounters();
          sendResponse({ success: true });
          break;

        case 'REFRESH_RULES':
          loadAndSendRules();
          sendResponse({ success: true });
          break;

        case 'UPDATE_ACTIVE_RULES':
          sendRulesToPage(message.rules || [], message.isEnabled);
          sendResponse({ success: true });
          break;
      }
    });
  } catch (e) {
    if (isContextInvalidatedError(e)) {
      markContextInvalidated();
    }
  }

  restoreTabState();
})();
