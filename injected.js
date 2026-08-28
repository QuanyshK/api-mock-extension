/**
 * Injected Script - выполняется в Main World страницы
 * Перехватывает fetch и XMLHttpRequest для мокирования API
 */

(function () {
  'use strict';

  // ======== Конфигурация и состояние ========
  let mockRules = [];
  const originalFetch = window.fetch;
  // Сохраняем оригинальный XMLHttpRequest до переопределения
  const OriginalXMLHttpRequest = window.XMLHttpRequest;
  const originalXHROpen = OriginalXMLHttpRequest.prototype.open;
  const originalXHRSend = OriginalXMLHttpRequest.prototype.send;
  const originalXHRSetRequestHeader = OriginalXMLHttpRequest.prototype.setRequestHeader;

  // ======== Утилиты для Glob паттернов ========
  function globToRegex(pattern) {
    // Экранируем специальные regex символы, кроме glob-специфичных
    let regex = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&')
      .replace(/\*\*/g, '{{GLOBSTAR}}')
      .replace(/\*/g, '[^/]*')
      .replace(/\?/g, '.')
      .replace(/{{GLOBSTAR}}/g, '.*');
    return new RegExp(regex, 'i');
  }

  function matchesPattern(url, pattern) {
    if (!pattern || !url) return false;
    
    // Проверяем glob паттерн
    if (pattern.includes('*') || pattern.includes('?')) {
      return globToRegex(pattern).test(url);
    }
    
    // Простая подстрока
    return url.toLowerCase().includes(pattern.toLowerCase());
  }

  function matchesMethod(requestMethod, ruleMethod) {
    if (!ruleMethod || ruleMethod === 'ALL') return true;
    return requestMethod.toUpperCase() === ruleMethod.toUpperCase();
  }

  function findMatchingRule(url, method) {
    return mockRules.find(rule => {
      if (!rule.enabled) return false;
      return matchesPattern(url, rule.urlPattern) && matchesMethod(method, rule.method);
    });
  }

  // ======== Отправка события о срабатывании мока ========
  function notifyMockHit(ruleId) {
    window.postMessage({
      type: 'MOCK_HIT',
      ruleId: ruleId,
      timestamp: Date.now()
    }, '*');
  }

  // ======== Создание замоканного Response ========
  function createMockResponse(rule) {
    const status = parseInt(rule.statusCode, 10) || 200;
    const headers = {
      'Content-Type': 'application/json',
      'X-Mocked-By': 'qk-api-mock'
    };

    let body = rule.responseBody || '{}';
    
    // Пытаемся распарсить как JSON для валидации
    try {
      JSON.parse(body);
    } catch (e) {
      // Если не валидный JSON, отправляем как text
      headers['Content-Type'] = 'text/plain';
    }

    return {
      status: status,
      statusText: getStatusText(status),
      headers: headers,
      body: body
    };
  }

  function getStatusText(status) {
    const statusTexts = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable'
    };
    return statusTexts[status] || 'Unknown';
  }

  // ======== Перехват Fetch ========
  window.fetch = function (input, init = {}) {
    const url = typeof input === 'string' ? input : input.url;
    const method = init.method || 'GET';

    const matchingRule = findMatchingRule(url, method);

    if (matchingRule) {
      notifyMockHit(matchingRule.id);

      const mockData = createMockResponse(matchingRule);

      return Promise.resolve(new Response(mockData.body, {
        status: mockData.status,
        statusText: mockData.statusText,
        headers: mockData.headers
      }));
    }

    return originalFetch.apply(this, arguments);
  };

  // ======== Перехват XMLHttpRequest ========
  function MockXHR() {
    this._method = 'GET';
    this._url = '';
    this._headers = {};
    this._requestHeaders = {};
    this._readyState = XMLHttpRequest.UNSENT;
    this._status = 0;
    this._statusText = '';
    this._responseText = '';
    this._responseHeaders = {};
    this._mockRule = null;
    this._sent = false;

    // Event handlers
    this.onreadystatechange = null;
    this.onload = null;
    this.onloadstart = null;
    this.onprogress = null;
    this.onerror = null;
    this.ontimeout = null;
    this.onloadend = null;

    // Event listeners
    this._listeners = {};
  }

  MockXHR.prototype = {
    get readyState() {
      return this._readyState;
    },

    get status() {
      return this._status;
    },

    get statusText() {
      return this._statusText;
    },

    get responseText() {
      return this._responseText;
    },

    get response() {
      return this._responseText;
    },

    get responseURL() {
      return this._url;
    },

    get UNSENT() { return 0; },
    get OPENED() { return 1; },
    get HEADERS_RECEIVED() { return 2; },
    get LOADING() { return 3; },
    get DONE() { return 4; },

    open: function (method, url, async, user, password) {
      this._method = method;
      this._url = url;
      this._readyState = XMLHttpRequest.OPENED;
      this._mockRule = findMatchingRule(url, method);
      this._dispatchEvent('readystatechange');
    },

    setRequestHeader: function (header, value) {
      this._requestHeaders[header] = value;
    },

    send: function (body) {
      if (this._mockRule) {
        notifyMockHit(this._mockRule.id);

        const mockData = createMockResponse(this._mockRule);

        // Имитируем асинхронное выполнение
        setTimeout(() => {
          this._readyState = XMLHttpRequest.HEADERS_RECEIVED;
          this._dispatchEvent('readystatechange');

          this._readyState = XMLHttpRequest.LOADING;
          this._dispatchEvent('readystatechange');
          this._dispatchEvent('loadstart');
          this._dispatchEvent('progress');

          this._status = mockData.status;
          this._statusText = mockData.statusText;
          this._responseText = mockData.body;
          this._responseHeaders = mockData.headers;

          this._readyState = XMLHttpRequest.DONE;
          this._dispatchEvent('readystatechange');
          this._dispatchEvent('load');
          this._dispatchEvent('loadend');
        }, 0);
      } else {
        // Делегируем оригинальному XHR
        const xhr = new OriginalXMLHttpRequest();
        const self = this;

        xhr.open(this._method, this._url, true);
        
        // Копируем заголовки
        for (const [header, value] of Object.entries(this._requestHeaders)) {
          xhr.setRequestHeader(header, value);
        }

        // Копируем event handlers
        xhr.onreadystatechange = function () {
          self._readyState = xhr.readyState;
          self._status = xhr.status;
          self._statusText = xhr.statusText;
          self._responseText = xhr.responseText;
          
          if (self.onreadystatechange) {
            self.onreadystatechange.call(self);
          }
          self._dispatchEvent('readystatechange');
        };

        xhr.onload = function () {
          if (self.onload) self.onload.call(self);
          self._dispatchEvent('load');
        };

        xhr.onerror = function () {
          if (self.onerror) self.onerror.call(self);
          self._dispatchEvent('error');
        };

        xhr.ontimeout = function () {
          if (self.ontimeout) self.ontimeout.call(self);
          self._dispatchEvent('timeout');
        };

        xhr.onloadend = function () {
          if (self.onloadend) self.onloadend.call(self);
          self._dispatchEvent('loadend');
        };

        xhr.send(body);
      }
    },

    abort: function () {
      this._readyState = XMLHttpRequest.UNSENT;
    },

    getAllResponseHeaders: function () {
      if (!this._mockRule) return '';
      return Object.entries(this._responseHeaders)
        .map(([key, value]) => `${key}: ${value}`)
        .join('\r\n');
    },

    getResponseHeader: function (header) {
      if (!this._mockRule) return null;
      return this._responseHeaders[header] || null;
    },

    addEventListener: function (type, listener) {
      if (!this._listeners[type]) {
        this._listeners[type] = [];
      }
      this._listeners[type].push(listener);
    },

    removeEventListener: function (type, listener) {
      if (!this._listeners[type]) return;
      const index = this._listeners[type].indexOf(listener);
      if (index !== -1) {
        this._listeners[type].splice(index, 1);
      }
    },

    _dispatchEvent: function (type) {
      if (this._listeners[type]) {
        this._listeners[type].forEach(listener => {
          try {
            listener.call(this, { type: type, target: this });
          } catch (e) {
            console.error('Error in event listener:', e);
          }
        });
      }
    }
  };

  // Заменяем XMLHttpRequest
  XMLHttpRequest = MockXHR;

  // ======== Обновление правил из content script ========
  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === 'MOCK_RULES_UPDATE') {
      mockRules = event.data.rules || [];
    }
  });

  // ======== Запрашиваем начальные правила ========
  window.postMessage({ type: 'MOCK_RULES_REQUEST' }, '*');

  // Помечаем, что скрипт загружен
  console.log('[qk-api-mock] Injected script loaded');
})();
