(function () {
  'use strict';

  if (window.__qk_api_mock_initialized) {
    return;
  }
  window.__qk_api_mock_initialized = true;

  let mockRules = [];
  let isEnabled = false;
  let originalFetch = window.__qk_original_fetch || null;
  let OriginalXMLHttpRequest = window.__qk_original_xhr || null;

  if (!originalFetch || !OriginalXMLHttpRequest) {
    try {
      const nativeFetch = window.fetch;
      const nativeXHR = window.XMLHttpRequest;

      if (nativeFetch && !nativeFetch.__qk_mocked) {
        originalFetch = nativeFetch;
        window.__qk_original_fetch = originalFetch;
      }

      if (nativeXHR && !nativeXHR.__qk_mocked && !(nativeXHR.prototype && nativeXHR.prototype._isMockXHR)) {
        OriginalXMLHttpRequest = nativeXHR;
        window.__qk_original_xhr = OriginalXMLHttpRequest;
      }
    } catch (e) {
      console.error('[qk-api-mock] Failed to save native APIs:', e);
      return;
    }
  }

  if (!originalFetch || !OriginalXMLHttpRequest) {
    console.error('[qk-api-mock] Native APIs not available, aborting');
    return;
  }

  function globToRegex(pattern) {
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
    if (pattern.includes('*') || pattern.includes('?')) {
      return globToRegex(pattern).test(url);
    }
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

  function mutateUrlWithPayload(url, payload) {
    try {
      const urlObj = new URL(url, window.location.origin);
      const params = new URLSearchParams(payload);
      for (const [key, value] of params) {
        urlObj.searchParams.set(key, value);
      }
      return urlObj.toString();
    } catch (e) {
      return url;
    }
  }

  function notifyMockHit(ruleId) {
    try {
      window.postMessage({
        type: 'MOCK_HIT',
        ruleId: ruleId,
        timestamp: Date.now()
      }, '*');
    } catch (e) {}
  }

  function getStatusText(status) {
    const statusTexts = {
      200: 'OK', 201: 'Created', 204: 'No Content',
      400: 'Bad Request', 401: 'Unauthorized', 403: 'Forbidden', 404: 'Not Found',
      500: 'Internal Server Error', 502: 'Bad Gateway', 503: 'Service Unavailable', 504: 'Gateway Timeout'
    };
    return statusTexts[status] || 'Unknown';
  }

  function createMockResponse(rule) {
    const status = parseInt(rule.statusCode, 10) || 200;
    const headers = {
      'Content-Type': 'application/json',
      'X-Mocked-By': 'qk-api-mock'
    };
    let body = rule.responseBody || '{}';
    try {
      JSON.parse(body);
    } catch (e) {
      headers['Content-Type'] = 'text/plain';
    }
    return {
      status: status,
      statusText: getStatusText(status),
      headers: headers,
      body: body,
      ok: status >= 200 && status < 300
    };
  }

  const NULL_BODY_STATUSES = [101, 103, 204, 205, 304];

  function createSafeResponse(body, status, statusText, headers) {
    try {
      const statusNum = parseInt(status, 10);
      const responseBody = NULL_BODY_STATUSES.includes(statusNum) ? null : new Blob([body], { type: headers['Content-Type'] || 'application/json' });
      return new Response(responseBody, {
        status: status,
        statusText: statusText,
        headers: headers
      });
    } catch (e) {
      console.error('[qk-api-mock] Failed to create Response:', e);
      const statusNum = parseInt(status, 10);
      const fallbackBody = NULL_BODY_STATUSES.includes(statusNum) ? null : body;
      return new Response(fallbackBody, {
        status: status,
        statusText: statusText,
        headers: headers
      });
    }
  }

  window.fetch = function fetch(input, init) {
    try {
      if (!isEnabled || !mockRules.length) {
        return originalFetch.call(this, input, init);
      }

      const originalUrl = typeof input === 'string' ? input : (input && input.url) || '';
      const originalMethod = ((init && init.method) || 'GET').toUpperCase();
      let mutatedUrl = originalUrl;
      let mutatedInit = init ? { ...init } : {};

      const matchingRule = findMatchingRule(originalUrl, originalMethod);

      if (matchingRule) {
        notifyMockHit(matchingRule.id);

        if (matchingRule.requestBody && matchingRule.requestBody.trim() !== '') {
          if (originalMethod === 'GET') {
            mutatedUrl = mutateUrlWithPayload(originalUrl, matchingRule.requestBody);
            if (typeof input !== 'string') {
              try {
                input = new Request(mutatedUrl, init);
              } catch (e) {
                input = mutatedUrl;
              }
            } else {
              input = mutatedUrl;
            }
          } else if (['POST', 'PUT', 'PATCH'].includes(originalMethod)) {
            mutatedInit.body = matchingRule.requestBody;
          }
        }

        if (matchingRule.responseBody && matchingRule.responseBody.trim() !== '') {
          const mockData = createMockResponse(matchingRule);
          return Promise.resolve(createSafeResponse(
            mockData.body,
            mockData.status,
            mockData.statusText,
            mockData.headers
          ));
        }
      }

      if (typeof input !== 'string') {
        return originalFetch.call(this, input, mutatedInit);
      } else {
        return originalFetch.call(this, mutatedUrl, mutatedInit);
      }
    } catch (e) {
      console.error('[qk-api-mock] Error in fetch interceptor:', e);
      return originalFetch.call(this, input, init);
    }
  };

  window.fetch.__qk_mocked = true;

  function MockXHR() {
    if (!isEnabled || !mockRules.length) {
      return new OriginalXMLHttpRequest();
    }

    this._method = 'GET';
    this._url = '';
    this._requestHeaders = {};
    this._readyState = XMLHttpRequest.UNSENT;
    this._status = 0;
    this._statusText = '';
    this._responseText = '';
    this._responseHeaders = {};
    this._mockRule = null;
    this._mutatedUrl = null;
    this._nativeXHR = null;
    this._responseType = '';
    this._withCredentials = false;
    this._timeout = 0;
    this._overrideMimeType = null;
    this.onreadystatechange = null;
    this.onload = null;
    this.onloadstart = null;
    this.onprogress = null;
    this.onerror = null;
    this.ontimeout = null;
    this.onloadend = null;
    this._listeners = {};
  }

  MockXHR.prototype = {
    get readyState() { return this._readyState; },
    get status() { return this._status; },
    get statusText() { return this._statusText; },
    get responseText() { return this._responseText; },
    get response() {
      if (this._nativeXHR && this._responseType && this._responseType !== '' && this._responseType !== 'text') {
        return this._nativeXHR.response;
      }
      return this._responseText;
    },
    get responseURL() { return this._url; },
    get responseType() { return this._responseType; },
    set responseType(value) { this._responseType = value; },
    get withCredentials() { return this._withCredentials; },
    set withCredentials(value) { this._withCredentials = value; },
    get timeout() { return this._timeout; },
    set timeout(value) { this._timeout = value; },
    get UNSENT() { return 0; },
    get OPENED() { return 1; },
    get HEADERS_RECEIVED() { return 2; },
    get LOADING() { return 3; },
    get DONE() { return 4; },

    open: function (method, url, async, user, password) {
      try {
        this._method = (method || 'GET').toUpperCase();
        this._url = url || '';
        this._readyState = XMLHttpRequest.OPENED;
        this._mockRule = findMatchingRule(this._url, this._method);
        this._mutatedUrl = null;

        if (this._mockRule && this._mockRule.requestBody && this._mockRule.requestBody.trim() !== '') {
          if (this._method === 'GET') {
            this._mutatedUrl = mutateUrlWithPayload(this._url, this._mockRule.requestBody);
          }
        }

        this._dispatchEvent('readystatechange');
      } catch (e) {
        console.error('[qk-api-mock] Error in XHR.open:', e);
      }
    },

    setRequestHeader: function (header, value) {
      this._requestHeaders[header] = value;
    },

    overrideMimeType: function (mimeType) {
      this._overrideMimeType = mimeType;
    },

    send: function (body) {
      const self = this;

      try {
        if (this._mockRule) {
          notifyMockHit(this._mockRule.id);

          let bodyToSend = body;
          if (this._mockRule.requestBody && this._mockRule.requestBody.trim() !== '') {
            if (['POST', 'PUT', 'PATCH'].includes(this._method)) {
              bodyToSend = this._mockRule.requestBody;
            }
          }

          if (this._mockRule.responseBody && this._mockRule.responseBody.trim() !== '') {
            const mockData = createMockResponse(this._mockRule);

            setTimeout(function() {
              try {
                self._readyState = XMLHttpRequest.HEADERS_RECEIVED;
                self._dispatchEvent('readystatechange');

                self._readyState = XMLHttpRequest.LOADING;
                self._dispatchEvent('readystatechange');

                if (self.onloadstart) {
                  try { self.onloadstart({ type: 'loadstart', target: self }); } catch (e) {}
                }
                self._dispatchEvent('loadstart');

                if (self.onprogress) {
                  try { self.onprogress({ type: 'progress', target: self }); } catch (e) {}
                }
                self._dispatchEvent('progress');

                self._status = mockData.status;
                self._statusText = mockData.statusText;
                self._responseText = mockData.body;
                self._responseHeaders = mockData.headers;

                self._readyState = XMLHttpRequest.DONE;
                self._dispatchEvent('readystatechange');

                if (self.onload) {
                  try { self.onload({ type: 'load', target: self }); } catch (e) {}
                }
                self._dispatchEvent('load');

                if (self.onloadend) {
                  try { self.onloadend({ type: 'loadend', target: self }); } catch (e) {}
                }
                self._dispatchEvent('loadend');
              } catch (e) {
                console.error('[qk-api-mock] Error in XHR mock response:', e);
              }
            }, 0);

            return;
          }
        }

        const xhr = new OriginalXMLHttpRequest();
        this._nativeXHR = xhr;
        const urlToUse = this._mutatedUrl || this._url;

        xhr.open(this._method, urlToUse, true);

        try {
          xhr.withCredentials = this._withCredentials;
        } catch (e) {}

        try {
          if (this._responseType) {
            xhr.responseType = this._responseType;
          }
        } catch (e) {}

        try {
          if (this._timeout) {
            xhr.timeout = this._timeout;
          }
        } catch (e) {}

        try {
          if (this._overrideMimeType) {
            xhr.overrideMimeType(this._overrideMimeType);
          }
        } catch (e) {}

        for (const header in this._requestHeaders) {
          if (this._requestHeaders.hasOwnProperty(header)) {
            try {
              xhr.setRequestHeader(header, this._requestHeaders[header]);
            } catch (e) {}
          }
        }

        xhr.onreadystatechange = function () {
          try {
            self._readyState = xhr.readyState;
            self._status = xhr.status;
            self._statusText = xhr.statusText;

            if (!xhr.responseType || xhr.responseType === '' || xhr.responseType === 'text') {
              self._responseText = xhr.responseText;
            }

            if (self.onreadystatechange) {
              try { self.onreadystatechange.call(self); } catch (e) {}
            }
            self._dispatchEvent('readystatechange');
          } catch (e) {
            console.error('[qk-api-mock] Error in XHR onreadystatechange:', e);
          }
        };

        xhr.onload = function () {
          if (self.onload) {
            try { self.onload.call(self); } catch (e) {}
          }
          self._dispatchEvent('load');
        };

        xhr.onerror = function () {
          if (self.onerror) {
            try { self.onerror.call(self); } catch (e) {}
          }
          self._dispatchEvent('error');
        };

        xhr.ontimeout = function () {
          if (self.ontimeout) {
            try { self.ontimeout.call(self); } catch (e) {}
          }
          self._dispatchEvent('timeout');
        };

        xhr.onloadend = function () {
          if (self.onloadend) {
            try { self.onloadend.call(self); } catch (e) {}
          }
          self._dispatchEvent('loadend');
        };

        xhr.send(body);
      } catch (e) {
        console.error('[qk-api-mock] Error in XHR.send:', e);
        try {
          this._readyState = XMLHttpRequest.DONE;
          this._dispatchEvent('readystatechange');
          this._dispatchEvent('error');
          this._dispatchEvent('loadend');
        } catch (err) {}
      }
    },

    abort: function () {
      if (this._nativeXHR) {
        this._nativeXHR.abort();
      }
      this._readyState = XMLHttpRequest.UNSENT;
    },

    getAllResponseHeaders: function () {
      if (this._nativeXHR) {
        return this._nativeXHR.getAllResponseHeaders();
      }
      if (!this._mockRule) return '';
      return Object.entries(this._responseHeaders)
        .map(function([key, value]) { return key + ': ' + value; })
        .join('\r\n');
    },

    getResponseHeader: function (header) {
      if (this._nativeXHR) {
        return this._nativeXHR.getResponseHeader(header);
      }
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
        this._listeners[type].forEach(function(listener) {
          try {
            listener.call(this, { type: type, target: this });
          } catch (e) {}
        }.bind(this));
      }
    }
  };

  try {
    if (window.XMLHttpRequest && !window.XMLHttpRequest.__qk_mocked) {
      MockXHR.prototype._isMockXHR = true;
      window.XMLHttpRequest = MockXHR;
      window.XMLHttpRequest.__qk_mocked = true;
    }
  } catch (e) {
    console.error('[qk-api-mock] Failed to replace XMLHttpRequest:', e);
  }

  window.addEventListener('message', function (event) {
    if (event.source !== window) return;
    if (!event.data) return;

    if (event.data.type === 'MOCK_RULES_UPDATE') {
      mockRules = event.data.rules || [];
      if (typeof event.data.isEnabled === 'boolean') {
        isEnabled = event.data.isEnabled;
      }
    }
  });

  try {
    window.postMessage({ type: 'MOCK_RULES_REQUEST' }, '*');
  } catch (e) {}

  console.log('[qk-api-mock] Injected script loaded');
})();
