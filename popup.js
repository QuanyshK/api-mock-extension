(function () {
  'use strict';

  const sidebar = document.getElementById('sidebar');
  const mainContent = document.getElementById('mainContent');
  const openSidebarBtn = document.getElementById('openSidebarBtn');
  const closeSidebarHeaderBtn = document.getElementById('closeSidebarHeaderBtn');
  const projectList = document.getElementById('projectList');
  const addProjectBtn = document.getElementById('addProjectBtn');
  const currentProjectName = document.getElementById('currentProjectName');
  const masterToggleBtn = document.getElementById('masterToggleBtn');
  const masterToggleIcon = document.getElementById('masterToggleIcon');

  const mockList = document.getElementById('mockList');
  const emptyState = document.getElementById('emptyState');
  const addMockBtn = document.getElementById('addMockBtn');
  const resetCountersBtn = document.getElementById('resetCountersBtn');
  const activeRulesCount = document.getElementById('activeRulesCount');

  const projectItemTemplate = document.getElementById('projectItemTemplate');
  const mockCardTemplate = document.getElementById('mockCardTemplate');

  let projects = [];
  let currentProjectId = null;
  let mockRules = [];
  let hitCounters = {};
  let autoSaveTimeout = null;
  let expandedCards = new Set();
  let currentTabId = null;

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

  function getStatusText(status) {
    const statusTexts = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
      500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
    };
    return statusTexts[status] || 'Unknown';
  }

  function loadData() {
    chrome.storage.local.get(['projects', 'currentProjectId', 'mockRules', 'hitCounters', 'sidebarCollapsed'], function (result) {
      projects = result.projects || [];
      currentProjectId = result.currentProjectId || null;
      mockRules = result.mockRules || [];
      hitCounters = result.hitCounters || {};

      if (projects.length === 0) {
        createDefaultProject();
      } else if (!currentProjectId || !projects.find(p => p.id === currentProjectId)) {
        currentProjectId = projects[0].id;
      }

      if (result.sidebarCollapsed) {
        sidebar.classList.add('collapsed');
      }

      renderProjects();
      updateActiveCount();
    });
  }

  function saveProjects() {
    chrome.storage.local.set({ projects: projects, currentProjectId: currentProjectId });
  }

  function saveRules() {
    chrome.storage.local.set({ mockRules: mockRules });
  }

  function saveHitCounters() {
    chrome.storage.local.set({ hitCounters: hitCounters });
  }

  const debouncedSaveRules = debounce(saveRules, 300);
  const debouncedSaveProjects = debounce(saveProjects, 300);

  function getActiveRules() {
    const activeProjects = projects.filter(p => p.enabled !== false).map(p => p.id);
    return mockRules.filter(r => r.enabled && activeProjects.includes(r.projectId));
  }

  function sendToggleToTab(enabled) {
    const activeRules = getActiveRules();

    chrome.tabs.sendMessage(currentTabId, {
      type: 'UPDATE_ACTIVE_RULES',
      rules: activeRules,
      isEnabled: enabled
    }, function () {
      if (chrome.runtime.lastError) {
        return;
      }
    });

    chrome.runtime.sendMessage({
      type: 'SET_TAB_ENABLED',
      tabId: currentTabId,
      enabled: enabled
    });
  }

  function openSidebar() {
    sidebar.classList.remove('collapsed');
    chrome.storage.local.set({ sidebarCollapsed: false });
  }

  function closeSidebar() {
    sidebar.classList.add('collapsed');
    chrome.storage.local.set({ sidebarCollapsed: true });
  }

  function handleClickOutside(e) {
    if (!sidebar.classList.contains('collapsed')) {
      const isClickInsideSidebar = sidebar.contains(e.target);
      const isClickOnOpenButton = openSidebarBtn.contains(e.target);

      if (!isClickInsideSidebar && !isClickOnOpenButton) {
        closeSidebar();
      }
    }
  }

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

    mockRules = mockRules.filter(r => r.projectId !== projectId);

    projects = projects.filter(p => p.id !== projectId);

    if (currentProjectId === projectId) {
      currentProjectId = projects[0].id;
    }

    saveProjects();
    saveRules();
    renderProjects();
    updateActiveCount();
  }

  function toggleProjectEnabled(projectId, enabled) {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    project.enabled = enabled;
    saveProjects();
    renderProjects();
    updateActiveCount();
  }

  function switchProject(projectId) {
    currentProjectId = projectId;
    saveProjects();
    renderProjects();
    updateActiveCount();
  }

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

    const enabledCheckbox = item.querySelector('.project-enabled');
    enabledCheckbox.checked = project.enabled !== false;
    enabledCheckbox.addEventListener('change', function (e) {
      e.stopPropagation();
      toggleProjectEnabled(project.id, this.checked);
    });

    item.addEventListener('click', function (e) {
      if (e.target.closest('.toggle') || e.target.closest('.project-actions')) {
        return;
      }
      switchProject(project.id);
    });

    const editBtn = item.querySelector('.btn-project-edit');
    editBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      renameProject(project.id);
    });

    const deleteBtn = item.querySelector('.btn-project-delete');
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteProject(project.id);
    });

    return item;
  }

  function getCurrentProjectRules() {
    return mockRules.filter(r => r.projectId === currentProjectId);
  }

  function updateActiveCount() {
    const currentRules = getCurrentProjectRules();
    const activeCount = currentRules.filter(r => r.enabled).length;
    activeRulesCount.textContent = `${activeCount} active`;

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

  function updateRequestBodyLabel(card, method) {
    const label = card.querySelector('.mock-request-body-label');
    const hint = card.querySelector('.mock-request-body-hint');
    const textarea = card.querySelector('.mock-request-body');

    if (method === 'GET') {
      label.textContent = 'Payload (Query Params)';
      hint.textContent = 'Optional: Override query params (e.g., param1=value1&param2=value2)';
      textarea.placeholder = 'param1=value1&param2=value2';
    } else if (['POST', 'PUT', 'PATCH'].includes(method)) {
      label.textContent = 'Request Body';
      hint.textContent = 'Optional: Override request body sent to server (JSON or string)';
      textarea.placeholder = '{"key": "value"}';
    } else {
      label.textContent = 'Request Body (Mutation)';
      hint.textContent = 'Optional: Override request data sent to server';
      textarea.placeholder = 'GET: query params, POST/PUT/PATCH: body';
    }
  }

  function createMockCard(rule) {
    const clone = mockCardTemplate.content.cloneNode(true);
    const card = clone.querySelector('.mock-card');

    card.dataset.ruleId = rule.id;

    if (expandedCards.has(rule.id)) {
      card.classList.add('expanded');
      card.querySelector('.btn-expand').classList.add('expanded');
    }

    const enabledCheckbox = card.querySelector('.mock-enabled');
    enabledCheckbox.checked = rule.enabled;
    enabledCheckbox.addEventListener('change', function () {
      const newEnabled = this.checked;
      updateRule(rule.id, { enabled: newEnabled });
      updateCardStatus(card, newEnabled);
      updateActiveCount();
    });

    updateCardStatus(card, rule.enabled);

    const expandBtn = card.querySelector('.btn-expand');
    expandBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      toggleCardExpand(card, rule.id);
    });

    const header = card.querySelector('.mock-card-header');
    header.addEventListener('click', function (e) {
      if (e.target.closest('.toggle') || e.target.closest('.btn-expand') || e.target.closest('.btn-delete')) {
        return;
      }
      toggleCardExpand(card, rule.id);
    });

    const deleteBtn = card.querySelector('.btn-delete');
    deleteBtn.addEventListener('click', function (e) {
      e.stopPropagation();
      deleteRule(rule.id);
    });

    const urlPatternInput = card.querySelector('.mock-url-pattern');
    urlPatternInput.value = rule.urlPattern || '';
    urlPatternInput.addEventListener('input', function () {
      updateRule(rule.id, { urlPattern: this.value });
      updateCompactDisplay(card, { ...rule, urlPattern: this.value });
    });

    const methodSelect = card.querySelector('.mock-method');
    methodSelect.value = rule.method || 'ALL';
    updateRequestBodyLabel(card, rule.method || 'ALL');
    methodSelect.addEventListener('change', function () {
      updateRule(rule.id, { method: this.value });
      updateCompactDisplay(card, { ...rule, method: this.value });
      updateRequestBodyLabel(card, this.value);
    });

    const statusCodeInput = card.querySelector('.mock-status-code');
    statusCodeInput.value = rule.statusCode || '200';
    statusCodeInput.addEventListener('input', function () {
      updateRule(rule.id, { statusCode: this.value });
    });

    const requestBodyTextarea = card.querySelector('.mock-request-body');
    requestBodyTextarea.value = rule.requestBody || '';
    requestBodyTextarea.addEventListener('input', function () {
      updateRule(rule.id, { requestBody: this.value });
    });

    const responseBodyTextarea = card.querySelector('.mock-response-body');
    responseBodyTextarea.value = rule.responseBody || '';
    responseBodyTextarea.addEventListener('input', function () {
      updateRule(rule.id, { responseBody: this.value });
    });
    responseBodyTextarea.addEventListener('blur', function () {
      if (this.value.trim()) {
        const formatted = formatJson(this.value);
        this.value = formatted;
        updateRule(rule.id, { responseBody: formatted });
      }
    });

    const hitCount = hitCounters[rule.id] || 0;
    card.querySelector('.hit-count').textContent = hitCount;

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
    urlDisplay.textContent = truncate(displayUrl, 45);
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
      responseBody: JSON.stringify({ success: true, message: 'Mocked response' }, null, 2),
      requestBody: ''
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

  function loadTabStatus() {
    chrome.storage.session.get(['tabEnabledStatus'], function (result) {
      const status = result.tabEnabledStatus || {};
      const isEnabled = status[currentTabId] || false;
      updateToggleUI(isEnabled);
    });
  }

  function updateToggleUI(isEnabled) {
    if (isEnabled) {
      masterToggleBtn.classList.add('active');
      masterToggleIcon.textContent = '⏸';
    } else {
      masterToggleBtn.classList.remove('active');
      masterToggleIcon.textContent = '▶';
    }
  }

  function toggleMaster() {
    chrome.storage.session.get(['tabEnabledStatus'], function (result) {
      const status = result.tabEnabledStatus || {};
      const newStatus = !status[currentTabId];
      status[currentTabId] = newStatus;
      chrome.storage.session.set({ tabEnabledStatus: status }, function () {
        updateToggleUI(newStatus);
        sendToggleToTab(newStatus);
      });
    });
  }

  openSidebarBtn.addEventListener('click', openSidebar);
  closeSidebarHeaderBtn.addEventListener('click', closeSidebar);
  addProjectBtn.addEventListener('click', addNewProject);
  addMockBtn.addEventListener('click', addNewRule);
  masterToggleBtn.addEventListener('click', toggleMaster);

  document.addEventListener('click', handleClickOutside);

  resetCountersBtn.addEventListener('click', function () {
    if (confirm('Reset all hit counters?')) {
      resetAllCounters();
    }
  });

  function init() {
    loadData();
    setupMessageListener();
    setupStorageListener();

    chrome.tabs.query({ active: true, currentWindow: true }, function (tabs) {
      if (tabs[0]) {
        currentTabId = tabs[0].id;
        loadTabStatus();
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
