/**
 * Popup Script - Extension UI Controller
 * Projects, auto-save, dynamic updates, counters, dropdown
 */

(function () {
  'use strict';

  // ======== DOM Elements ========
  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('mainContent');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarHeaderBtn = document.getElementById('closeSidebarHeaderBtn');
  const projectList = document.getElementById('projectList');
  const addProjectBtn = document.getElementById('addProjectBtn');
  const currentProjectName = document.getElementById('currentProjectName');
  
  const mockList = document.getElementById('mockList');
  const emptyState = document.getElementById('emptyState');
  const addMockBtn = document.getElementById('addMockBtn');
  const resetCountersBtn = document.getElementById('resetCountersBtn');
  const activeRulesCount = document.getElementById('activeRulesCount');
  
  const projectItemTemplate = document.getElementById('projectItemTemplate');
  const mockCardTemplate = document.getElementById('mockCardTemplate');

  // ======== State ========
  let projects = [];
  let currentProjectId = null;
  let mockRules = [];
  let hitCounters = {};
  let autoSaveTimeout = null;
  let expandedCards = new Set();

  // ======== Utility Functions ========
  function generateId() {
    return 'id_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }

  function debounce(func, wait) {
    return function executedFunction(...args) {
      const later = () => {
        clearTimeout(autoSaveTimeout);
        func(...args);
      };
      clearTimeout(autoSaveTimeout);
      autoSaveTimeout = setTimeout(later, wait);
    };
  }

  function formatJson(jsonString) {
    try {
      const obj = JSON.parse(jsonString);
      return JSON.stringify(obj, null, 2);
    } catch (e) {
      return jsonString;
    }
  }

  function truncate(str, maxLength) {
    if (!str) return '';
    return str.length > maxLength ? str.substring(0, maxLength) + '...' : str;
  }

  // ======== Storage Operations ========
  function loadData() {
    chrome.storage.local.get(['projects', 'currentProjectId', 'mockRules', 'hitCounters', 'sidebarCollapsed'], function (result) {
      projects = result.projects || [];
      currentProjectId = result.currentProjectId || null;
      mockRules = result.mockRules || [];
      hitCounters = result.hitCounters || {};

      // Create default project if none exists
      if (projects.length === 0) {
        createDefaultProject();
      } else if (!currentProjectId || !projects.find(p => p.id === currentProjectId)) {
        currentProjectId = projects[0].id;
      }

      // Apply sidebar state
      if (result.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
      }

      renderProjects();
      sendRulesToContent();
      updateActiveCount();
    });
  }

  function saveProjects() {
    chrome.storage.local.set({ projects: projects, currentProjectId: currentProjectId });
  }

  function saveRules() {
    chrome.storage.local.set({ mockRules: mockRules }, function () {
      console.log('[qk-api-mock] Rules saved');
      sendRulesToContent();
    });
  }

  function saveHitCounters() {
    chrome.storage.local.set({ hitCounters: hitCounters });
  }

  const debouncedSaveRules = debounce(saveRules, 300);
  const debouncedSaveProjects = debounce(saveProjects, 300);

  // ======== Send Active Rules to Content Script ========
  function sendRulesToContent() {
    // Get only enabled rules from enabled projects
    const activeProjects = projects.filter(p => p.enabled !== false).map(p => p.id);
    const activeRules = mockRules.filter(r => 
      r.enabled && activeProjects.includes(r.projectId)
    );
    
    // Send to all tabs
    chrome.tabs.query({}, function(tabs) {
      tabs.forEach(tab => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'UPDATE_ACTIVE_RULES',
          rules: activeRules
        }).catch(() => {
          // Ignore errors for tabs without content script
        });
      });
    });
  }

  // ======== Sidebar Toggle ========
  function openSidebar() {
    sidebar.classList.remove('collapsed');
    chrome.storage.local.set({ sidebarCollapsed: false });
  }

  function closeSidebar() {
    sidebar.classList.add('collapsed');
    chrome.storage.local.set({ sidebarCollapsed: true });
  }

  // ======== Click Outside Handler ========
  function handleClickOutside(e) {
    if (!sidebar.classList.contains('collapsed')) {
      const isClickInsideSidebar = sidebar.contains(e.target);
      const isClickOnOpenButton = openSidebarBtn.contains(e.target);
      
      if (!isClickInsideSidebar && !isClickOnOpenButton) {
        closeSidebar();
      }
    }
  }

  // ======== Project Management ========
  function createDefaultProject() {
    const defaultProject = {
      id: generateId(),
      name: 'Default Project',
      enabled: true
    };
    projects.push(defaultProject);
    currentProjectId = defaultProject.id;
    saveProjects();
  }

  function addNewProject() {
    const name = prompt('Enter project name:', 'New Project');
    if (!name || name.trim() === '') return;

    const newProject = {
      id: generateId(),
      name: name.trim(),
      enabled: true
    };

    projects.push(newProject);
    currentProjectId = newProject.id;
    saveProjects();
    renderProjects();
    sendRulesToContent();
    updateActiveCount();
  }

  function renameProject(projectId) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    const newName = prompt('New project name:', project.name);
    if (!newName || newName.trim() === '') return;

    project.name = newName.trim();
    saveProjects();
    renderProjects();
    
    if (currentProjectId === projectId) {
      currentProjectName.textContent = project.name;
    }
  }

  function deleteProject(projectId) {
    if (projects.length <= 1) {
      alert('Cannot delete the last project');
      return;
    }

    if (!confirm('Delete project and all its mocks?')) return;

    // Delete all mocks of this project
    mockRules = mockRules.filter(r => r.projectId !== projectId);
    
    // Delete project
    projects = projects.filter(p => p.id !== projectId);
    
    // Switch to another project
    if (currentProjectId === projectId) {
      currentProjectId = projects[0].id;
    }

    saveProjects();
    saveRules();
    renderProjects();
    sendRulesToContent();
    updateActiveCount();
  }

  function toggleProjectEnabled(projectId, enabled) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;
    
    project.enabled = enabled;
    saveProjects();
    renderProjects();
    sendRulesToContent();
    updateActiveCount();
  }

  function switchProject(projectId) {
    currentProjectId = projectId;
    saveProjects();
    renderProjects();
    updateActiveCount();
  }

  // ======== Rendering Projects ========
  function renderProjects() {
    projectList.innerHTML = '';

    projects.forEach(project => {
      const item = createProjectItem(project);
      projectList.appendChild(item);
    });

    const currentProject = projects.find(p => p.id === currentProjectId);
    if (currentProject) {
      currentProjectName.textContent = currentProject.name;
    }
  }

  function createProjectItem(project) {
    const clone = projectItemTemplate.content.cloneNode(true);
    const item = clone.querySelector('.project-item');
    
    item.dataset.projectId = project.id;
    item.querySelector('.project-name').textContent = project.name;

    if (project.id === currentProjectId) {
      item.classList.add('active');
    }

    // Project enabled toggle
    const enabledCheckbox = item.querySelector('.project-enabled');
    enabledCheckbox.checked = project.enabled !== false;
    enabledCheckbox.addEventListener('change', function (e) {
      e.stopPropagation();
      toggleProjectEnabled(project.id, this.checked);
    });

    // Click to switch (only if not clicking toggle or buttons)
    item.addEventListener('click', function (e) {
      if (e.target.closest('.toggle') || e.target.closest('.project-actions')) {
        return;
      }
      switchProject(project.id);
    });

    // Edit button
    item.querySelector('.btn-project-edit').addEventListener('click', function (e) {
      e.stopPropagation();
      renameProject(project.id);
    });

    // Delete button
    item.querySelector('.btn-project-delete').addEventListener('click', function (e) {
      e.stopPropagation();
      deleteProject(project.id);
    });

    return item;
  }

  // ======== Rendering Mocks ========
  function getCurrentProjectRules() {
    return mockRules.filter(r => r.projectId === currentProjectId);
  }

  function updateActiveCount() {
    const currentRules = getCurrentProjectRules();
    const activeCount = currentRules.filter(r => r.enabled).length;
    activeRulesCount.textContent = `${activeCount} active`;
    
    // Show/hide empty state
    if (currentRules.length === 0) {
      mockList.innerHTML = '';
      emptyState.style.display = 'flex';
    } else {
      emptyState.style.display = 'none';
      renderRulesList(currentRules);
    }
  }

  function renderRulesList(rules) {
    mockList.innerHTML = '';
    rules.forEach(rule => {
      const card = createMockCard(rule);
      mockList.appendChild(card);
    });
    updateHitCounters();
  }

  function createMockCard(rule) {
    const clone = mockCardTemplate.content.cloneNode(true);
    const card = clone.querySelector('.mock-card');
    
    card.dataset.ruleId = rule.id;

    // Expanded state
    if (expandedCards.has(rule.id)) {
      card.classList.add('expanded');
      card.querySelector('.btn-expand').classList.add('expanded');
    }

    // Enabled toggle
    const enabledCheckbox = card.querySelector('.mock-enabled');
    enabledCheckbox.checked = rule.enabled;
    enabledCheckbox.addEventListener('change', function () {
      updateRule(rule.id, { enabled: this.checked });
      updateCardStatus(card, this.checked);
      sendRulesToContent();
      updateActiveCount();
    });

    // Status badge
    updateCardStatus(card, rule.enabled);

    // Expand button
    const expandBtn = card.querySelector('.btn-expand');
    expandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCardExpand(card, rule.id);
    });

    // Header click to expand
    const header = card.querySelector('.mock-card-header');
    header.addEventListener('click', function (e) {
      if (e.target.closest('.toggle') || e.target.closest('.btn-expand') || e.target.closest('.btn-delete')) {
        return;
      }
      toggleCardExpand(card, rule.id);
    });

    // Delete button
    const deleteBtn = card.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteRule(rule.id);
    });

    // URL Pattern
    const urlPatternInput = card.querySelector('.mock-url-pattern');
    urlPatternInput.value = rule.urlPattern || '';
    urlPatternInput.addEventListener('input', function () {
      updateRule(rule.id, { urlPattern: this.value });
      updateCompactDisplay(card, { ...rule, urlPattern: this.value });
      sendRulesToContent();
    });

    // Method
    const methodSelect = card.querySelector('.mock-method');
    methodSelect.value = rule.method || 'ALL';
    methodSelect.addEventListener('change', function () {
      updateRule(rule.id, { method: this.value });
      updateCompactDisplay(card, { ...rule, method: this.value });
      sendRulesToContent();
    });

    // Status Code
    const statusCodeInput = card.querySelector('.mock-status-code');
    statusCodeInput.value = rule.statusCode || '200';
    statusCodeInput.addEventListener('input', function () {
      updateRule(rule.id, { statusCode: this.value });
      sendRulesToContent();
    });

    // Response Body
    const responseBodyTextarea = card.querySelector('.mock-response-body');
    responseBodyTextarea.value = rule.responseBody || '';
    responseBodyTextarea.addEventListener('input', function () {
      updateRule(rule.id, { responseBody: this.value });
      sendRulesToContent();
    });

    // Format JSON on blur
    responseBodyTextarea.addEventListener('blur', function () {
      if (this.value.trim()) {
        const formatted = formatJson(this.value);
        this.value = formatted;
        updateRule(rule.id, { responseBody: formatted });
        sendRulesToContent();
      }
    });

    // Hit counter
    const hitCount = hitCounters[rule.id] || 0;
    card.querySelector('.hit-count').textContent = hitCount;

    // Compact display
    updateCompactDisplay(card, rule);

    return card;
  }

  function toggleCardExpand(card, ruleId) {
    const isExpanded = card.classList.contains('expanded');
    const expandBtn = card.querySelector('.btn-expand');
    
    if (isExpanded) {
      card.classList.remove('expanded');
      expandBtn.classList.remove('expanded');
      expandedCards.delete(ruleId);
    } else {
      card.classList.add('expanded');
      expandBtn.classList.add('expanded');
      expandedCards.add(ruleId);
    }
  }

  function updateCompactDisplay(card, rule) {
    const urlDisplay = card.querySelector('.mock-url-display');
    const methodBadge = card.querySelector('.mock-method-badge');
    
    const displayUrl = rule.urlPattern || 'No URL';
    urlDisplay.textContent = truncate(displayUrl, 35);
    urlDisplay.title = displayUrl;
    
    methodBadge.textContent = rule.method || 'ALL';
    methodBadge.className = 'mock-method-badge ' + (rule.method || 'ALL');
  }

  function updateCardStatus(card, enabled) {
    const badge = card.querySelector('.mock-status-badge');
    if (enabled) {
      badge.textContent = 'On';
      badge.classList.remove('disabled');
      card.classList.remove('disabled');
    } else {
      badge.textContent = 'Off';
      badge.classList.add('disabled');
      card.classList.add('disabled');
    }
  }

  function updateHitCounters() {
    const currentRules = getCurrentProjectRules();
    currentRules.forEach(rule => {
      const card = mockList.querySelector(`[data-rule-id="${rule.id}"]`);
      if (card) {
        const hitCount = hitCounters[rule.id] || 0;
        card.querySelector('.hit-count').textContent = hitCount;
      }
    });
  }

  // ======== Rule Management ========
  function addNewRule() {
    if (!currentProjectId) {
      alert('Create a project first');
      return;
    }

    const newRule = {
      id: generateId(),
      projectId: currentProjectId,
      enabled: true,
      urlPattern: '**/api/example',
      method: 'GET',
      statusCode: '200',
      responseBody: JSON.stringify({ success: true, message: 'Mocked response' }, null, 2)
    };

    mockRules.push(newRule);
    expandedCards.add(newRule.id);
    saveRules();
    updateActiveCount();

    setTimeout(() => {
      mockList.lastElementChild?.scrollIntoView({ behavior: 'smooth' });
    }, 100);
  }

  function deleteRule(ruleId) {
    mockRules = mockRules.filter(r => r.id !== ruleId);
    delete hitCounters[ruleId];
    expandedCards.delete(ruleId);
    saveRules();
    sendRulesToContent();
    updateActiveCount();
  }

  function updateRule(ruleId, updates) {
    const index = mockRules.findIndex(r => r.id === ruleId);
    if (index !== -1) {
      mockRules[index] = { ...mockRules[index], ...updates };
      debouncedSaveRules();
    }
  }

  function resetAllCounters() {
    hitCounters = {};
    saveHitCounters();
    updateHitCounters();
  }

  // ======== Message Handling ========
  function setupMessageListener() {
    chrome.runtime.onMessage.addListener(function (message, sender, sendResponse) {
      if (message.type === 'HIT_COUNTER_UPDATED') {
        hitCounters[message.ruleId] = message.count;
        
        const card = mockList.querySelector(`[data-rule-id="${message.ruleId}"]`);
        if (card) {
          card.querySelector('.hit-count').textContent = message.count;
        }
      }
    });
  }

  // ======== Storage Change Listener ========
  function setupStorageListener() {
    chrome.storage.onChanged.addListener(function (changes, namespace) {
      if (namespace !== 'local') return;

      if (changes.hitCounters) {
        hitCounters = changes.hitCounters.newValue || {};
        updateHitCounters();
      }

      if (changes.mockRules) {
        const newRules = changes.mockRules.newValue || [];
        if (JSON.stringify(newRules) !== JSON.stringify(mockRules)) {
          mockRules = newRules;
          updateActiveCount();
        }
      }

      if (changes.projects) {
        const newProjects = changes.projects.newValue || [];
        if (JSON.stringify(newProjects) !== JSON.stringify(projects)) {
          projects = newProjects;
          renderProjects();
        }
      }

      if (changes.currentProjectId) {
        currentProjectId = changes.currentProjectId.newValue;
        renderProjects();
        updateActiveCount();
      }

      if (changes.sidebarCollapsed) {
        if (changes.sidebarCollapsed.newValue) {
          sidebar.classList.add('collapsed');
        } else {
          sidebar.classList.remove('collapsed');
        }
      }
    });
  }

  // ======== Event Listeners ========
  openSidebarBtn.addEventListener('click', openSidebar);
  closeSidebarHeaderBtn.addEventListener('click', closeSidebar);
  addProjectBtn.addEventListener('click', addNewProject);
  addMockBtn.addEventListener('click', addNewRule);
  
  document.addEventListener('click', handleClickOutside);
  
  resetCountersBtn.addEventListener('click', function () {
    if (confirm('Reset all hit counters?')) {
      resetAllCounters();
    }
  });

  // ======== Initialization ========
  function init() {
    loadData();
    setupMessageListener();
    setupStorageListener();
    console.log('[qk-api-mock] Popup initialized');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
