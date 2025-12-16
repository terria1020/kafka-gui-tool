// JSONPath 라이브러리 (브라우저용 번들 또는 직접 구현)
// jsonpath-plus는 브라우저에서 직접 사용 불가하므로 간단한 JSONPath 평가기 구현
const JSONPathEvaluator = {
  // JSONPath 표현식 평가
  evaluate(obj, path) {
    if (!path || !path.startsWith('$')) return null;

    // 비교 연산자 파싱 ($.data.status == "error")
    const comparisonMatch = path.match(/^(.+?)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
    if (comparisonMatch) {
      const [, jsonPath, operator, valueStr] = comparisonMatch;
      const actualValue = this.getValueByPath(obj, jsonPath.trim());
      const expectedValue = this.parseValue(valueStr.trim());

      return this.compare(actualValue, operator, expectedValue);
    }

    // 단순 경로 접근 (값 존재 여부 확인)
    const value = this.getValueByPath(obj, path);
    return value !== undefined && value !== null;
  },

  // 경로로 값 가져오기
  getValueByPath(obj, path) {
    if (!path.startsWith('$')) return undefined;

    // $ 제거하고 경로 파싱
    const pathStr = path.substring(1);
    if (!pathStr || pathStr === '') return obj;

    const parts = this.parsePath(pathStr);
    let current = obj;

    for (const part of parts) {
      if (current === null || current === undefined) return undefined;

      if (part.type === 'property') {
        current = current[part.value];
      } else if (part.type === 'index') {
        current = current[part.value];
      }
    }

    return current;
  },

  // 경로 파싱
  parsePath(pathStr) {
    const parts = [];
    const regex = /\.([a-zA-Z_][a-zA-Z0-9_]*)|^\[(\d+)\]|\[(\d+)\]|\.?\[["'](.+?)["']\]/g;
    let match;

    // 시작이 .으로 시작하지 않으면 첫 번째 속성 추출
    if (pathStr.startsWith('.')) {
      pathStr = pathStr.substring(1);
    }

    // 간단한 점 표기법 파싱
    const simpleParts = pathStr.split(/\.|\[|\]/).filter(p => p !== '');

    for (const part of simpleParts) {
      if (/^\d+$/.test(part)) {
        parts.push({ type: 'index', value: parseInt(part) });
      } else if (part.startsWith('"') || part.startsWith("'")) {
        parts.push({ type: 'property', value: part.slice(1, -1) });
      } else {
        parts.push({ type: 'property', value: part });
      }
    }

    return parts;
  },

  // 문자열 값 파싱
  parseValue(valueStr) {
    // 문자열 (따옴표로 감싸진 경우)
    if ((valueStr.startsWith('"') && valueStr.endsWith('"')) ||
        (valueStr.startsWith("'") && valueStr.endsWith("'"))) {
      return valueStr.slice(1, -1);
    }
    // 숫자
    if (!isNaN(valueStr)) {
      return parseFloat(valueStr);
    }
    // 불린
    if (valueStr === 'true') return true;
    if (valueStr === 'false') return false;
    if (valueStr === 'null') return null;

    return valueStr;
  },

  // 비교 연산
  compare(actual, operator, expected) {
    switch (operator) {
      case '==': return actual == expected;
      case '!=': return actual != expected;
      case '>': return actual > expected;
      case '<': return actual < expected;
      case '>=': return actual >= expected;
      case '<=': return actual <= expected;
      default: return false;
    }
  },

  // JSONPath 생성 (객체 탐색용)
  generatePaths(obj, basePath = '$') {
    const paths = [];

    const traverse = (current, path) => {
      if (current === null || current === undefined) return;

      if (typeof current === 'object' && !Array.isArray(current)) {
        for (const key of Object.keys(current)) {
          const newPath = `${path}.${key}`;
          paths.push({ path: newPath, value: current[key] });
          traverse(current[key], newPath);
        }
      } else if (Array.isArray(current)) {
        current.forEach((item, index) => {
          const newPath = `${path}[${index}]`;
          paths.push({ path: newPath, value: item });
          traverse(item, newPath);
        });
      }
    };

    paths.push({ path: basePath, value: obj });
    traverse(obj, basePath);
    return paths;
  }
};

// Settings Manager (설정 관리)
class SettingsManager {
  constructor() {
    this.defaults = {
      maxMessages: 1000
    };
    this.settings = this.loadSettings();
    this.listeners = [];
  }

  loadSettings() {
    try {
      const stored = localStorage.getItem('kafka-gui-settings');
      if (stored) {
        const parsed = JSON.parse(stored);
        return {
          maxMessages: this.validateMaxMessages(parsed.maxMessages)
        };
      }
    } catch (e) {
      console.error('Failed to load settings:', e);
    }
    return { ...this.defaults };
  }

  validateMaxMessages(value) {
    const num = parseInt(value, 10);
    if (isNaN(num)) return this.defaults.maxMessages;
    return Math.max(10, Math.min(100000, num));
  }

  saveSettings(newSettings) {
    this.settings = {
      ...this.settings,
      maxMessages: this.validateMaxMessages(newSettings.maxMessages)
    };
    localStorage.setItem('kafka-gui-settings', JSON.stringify(this.settings));
    this.notifyListeners();
  }

  getMaxMessages() {
    return this.settings.maxMessages;
  }

  addListener(callback) {
    this.listeners.push(callback);
  }

  removeListener(callback) {
    this.listeners = this.listeners.filter(l => l !== callback);
  }

  notifyListeners() {
    this.listeners.forEach(callback => callback(this.settings));
  }
}

// 전역 설정 매니저
const settingsManager = new SettingsManager();

// Tab Management
class TabManager {
  constructor() {
    this.tabs = new Map();
    this.activeTabId = null;
    this.tabCounter = 0;

    this.tabsContainer = document.getElementById('tabs-container');
    this.panelsContainer = document.getElementById('tab-panels-container');
    this.addTabBtn = document.getElementById('add-tab-btn');
    this.panelTemplate = document.getElementById('tab-panel-template');

    this.setupEventListeners();
    this.createTab(); // 초기 탭 생성
  }

  setupEventListeners() {
    this.addTabBtn.addEventListener('click', () => this.createTab());

    // 메시지 수신 리스너
    window.kafkaAPI.onMessage((message) => {
      const tab = this.tabs.get(message.consumerId);
      if (tab) {
        tab.addMessage(message);
      }
    });
  }

  createTab(topic = '') {
    const tabId = `tab-${++this.tabCounter}`;
    const tabLabel = topic || `Tab ${this.tabCounter}`;

    // Tab button 생성
    const tabBtn = document.createElement('button');
    tabBtn.className = 'tab';
    tabBtn.dataset.tabId = tabId;
    tabBtn.innerHTML = `
      <span class="tab-label">${tabLabel}</span>
      <button class="tab-close" title="탭 닫기">&times;</button>
    `;

    tabBtn.addEventListener('click', (e) => {
      if (!e.target.classList.contains('tab-close')) {
        this.switchTab(tabId);
      }
    });

    tabBtn.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      this.closeTab(tabId);
    });

    this.tabsContainer.appendChild(tabBtn);

    // Panel 생성
    const panelContent = this.panelTemplate.content.cloneNode(true);
    const panel = panelContent.querySelector('.tab-panel');
    panel.dataset.tabId = tabId;

    // Radio 버튼 이름 고유하게 설정
    panel.querySelectorAll('.mode-radio').forEach(radio => {
      radio.name = `mode-${tabId}`;
    });

    this.panelsContainer.appendChild(panel);

    // TabController 생성
    const tabController = new TabController(tabId, panel, this);
    this.tabs.set(tabId, tabController);

    // 탭 활성화
    this.switchTab(tabId);

    return tabController;
  }

  switchTab(tabId) {
    // 이전 활성 탭 비활성화
    if (this.activeTabId) {
      const prevTab = this.tabsContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
      const prevPanel = this.panelsContainer.querySelector(`[data-tab-id="${this.activeTabId}"]`);
      if (prevTab) prevTab.classList.remove('active');
      if (prevPanel) prevPanel.classList.remove('active');
    }

    // 새 탭 활성화
    const newTab = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    const newPanel = this.panelsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (newTab) newTab.classList.add('active');
    if (newPanel) newPanel.classList.add('active');

    this.activeTabId = tabId;
  }

  async closeTab(tabId) {
    const tabController = this.tabs.get(tabId);
    if (tabController) {
      await tabController.cleanup();
    }

    // DOM에서 제거
    const tab = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    const panel = this.panelsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) tab.remove();
    if (panel) panel.remove();

    this.tabs.delete(tabId);

    // 다른 탭으로 전환
    if (this.activeTabId === tabId) {
      const remainingTabs = Array.from(this.tabs.keys());
      if (remainingTabs.length > 0) {
        this.switchTab(remainingTabs[remainingTabs.length - 1]);
      } else {
        this.activeTabId = null;
        this.createTab(); // 모든 탭이 닫히면 새 탭 생성
      }
    }
  }

  updateTabLabel(tabId, label) {
    const tab = this.tabsContainer.querySelector(`[data-tab-id="${tabId}"]`);
    if (tab) {
      const labelEl = tab.querySelector('.tab-label');
      if (labelEl) {
        labelEl.textContent = label || `Tab`;
      }
    }
  }
}

// Tab Controller (각 탭의 기능 관리)
class TabController {
  constructor(tabId, panel, tabManager) {
    this.tabId = tabId;
    this.panel = panel;
    this.tabManager = tabManager;
    this.messages = [];
    this.filteredMessages = [];
    this.extractedValues = new Map(); // msg offset -> extracted value
    this.activeValueFilter = null; // 활성 JSONPath 필터
    this.isConsuming = false;

    // Settings Manager에서 maxMessages 가져오기
    this.maxMessages = settingsManager.getMaxMessages();

    // 설정 변경 리스너 등록
    this.onSettingsChange = this.onSettingsChange.bind(this);
    settingsManager.addListener(this.onSettingsChange);

    this.initElements();
    this.setupEventListeners();
  }

  onSettingsChange(settings) {
    this.maxMessages = settings.maxMessages;
    // 새 제한에 맞게 필터 및 메시지 제한 다시 적용
    this.applyFilterAndEnforceLimit();
  }

  initElements() {
    // Connection elements
    this.brokerInput = this.panel.querySelector('.broker-input');
    this.topicInput = this.panel.querySelector('.topic-input');
    this.groupInput = this.panel.querySelector('.group-input');
    this.modeRadios = this.panel.querySelectorAll('.mode-radio');

    // Consumer elements
    this.consumerSection = this.panel.querySelector('.consumer-section');
    this.filterInput = this.panel.querySelector('.filter-input');
    this.valueFilterInput = this.panel.querySelector('.value-filter-input');
    this.filterBtn = this.panel.querySelector('.filter-btn');
    this.startBtn = this.panel.querySelector('.start-btn');
    this.stopBtn = this.panel.querySelector('.stop-btn');
    this.clearBtn = this.panel.querySelector('.clear-btn');
    this.exportBtn = this.panel.querySelector('.export-btn');
    this.exportMenu = this.panel.querySelector('.export-menu');
    this.exportJsonBtn = this.panel.querySelector('.export-json-btn');
    this.exportTxtBtn = this.panel.querySelector('.export-txt-btn');
    this.statusIndicator = this.panel.querySelector('.status-indicator');
    this.statusText = this.panel.querySelector('.status-text');
    this.messageCount = this.panel.querySelector('.message-count');
    this.messagesBody = this.panel.querySelector('.messages-body');

    // Producer elements
    this.producerSection = this.panel.querySelector('.producer-section');
    this.producerKeyInput = this.panel.querySelector('.producer-key-input');
    this.producerValueInput = this.panel.querySelector('.producer-value-input');
    this.repeatCheckbox = this.panel.querySelector('.repeat-checkbox');
    this.repeatOptions = this.panel.querySelector('.repeat-options');
    this.repeatIntervalInput = this.panel.querySelector('.repeat-interval-input');
    this.repeatCountInput = this.panel.querySelector('.repeat-count-input');
    this.sendBtn = this.panel.querySelector('.send-btn');
    this.sendStatus = this.panel.querySelector('.send-status');
  }

  setupEventListeners() {
    // Mode toggle
    this.modeRadios.forEach(radio => {
      radio.addEventListener('change', () => this.handleModeChange(radio.value));
    });

    // Topic input change - update tab label
    this.topicInput.addEventListener('input', () => {
      this.tabManager.updateTabLabel(this.tabId, this.topicInput.value);
    });

    // Consumer controls
    this.startBtn.addEventListener('click', () => this.startConsumer());
    this.stopBtn.addEventListener('click', () => this.stopConsumer());
    this.clearBtn.addEventListener('click', () => this.clearMessages());

    // Filter
    this.filterInput.addEventListener('input', () => this.applyFilter());
    this.valueFilterInput.addEventListener('input', () => this.applyFilter());
    this.filterBtn.addEventListener('click', () => this.applyFilter());

    // Export
    this.exportBtn.addEventListener('click', () => {
      this.exportMenu.classList.toggle('hidden');
    });
    this.exportJsonBtn.addEventListener('click', () => this.exportMessages('json'));
    this.exportTxtBtn.addEventListener('click', () => this.exportMessages('txt'));

    // Close export menu when clicking outside
    document.addEventListener('click', (e) => {
      if (!this.exportBtn.contains(e.target) && !this.exportMenu.contains(e.target)) {
        this.exportMenu.classList.add('hidden');
      }
    });

    // Producer controls
    this.repeatCheckbox.addEventListener('change', () => {
      this.repeatOptions.classList.toggle('hidden', !this.repeatCheckbox.checked);
    });
    this.sendBtn.addEventListener('click', () => this.sendMessage());
  }

  handleModeChange(mode) {
    if (mode === 'consumer') {
      this.consumerSection.classList.remove('hidden');
      this.producerSection.classList.add('hidden');
    } else {
      this.consumerSection.classList.add('hidden');
      this.producerSection.classList.remove('hidden');
    }
  }

  async startConsumer() {
    const broker = this.brokerInput.value.trim();
    const topic = this.topicInput.value.trim();
    const groupId = this.groupInput.value.trim();

    if (!broker || !topic) {
      this.showError('Broker와 Topic을 입력해주세요.');
      return;
    }

    this.updateStatus('connecting', 'Connecting...');
    this.startBtn.disabled = true;
    this.stopBtn.disabled = false; // 연결 중에도 Stop 버튼 활성화

    // 연결 타임아웃 설정 (15초)
    const connectionTimeout = 15000;
    let timeoutId = null;
    let isTimedOut = false;

    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => {
        isTimedOut = true;
        reject(new Error('Connection timeout: 연결 시간이 초과되었습니다.'));
      }, connectionTimeout);
    });

    try {
      const result = await Promise.race([
        window.kafkaAPI.startConsumer({
          consumerId: this.tabId,
          broker,
          topic,
          groupId: groupId || null
        }),
        timeoutPromise
      ]);

      clearTimeout(timeoutId);

      if (result.success) {
        this.isConsuming = true;
        this.updateStatus('connected', 'Connected');
        this.startBtn.disabled = true;
        this.stopBtn.disabled = false;
        this.tabManager.updateTabLabel(this.tabId, topic);
      } else {
        this.updateStatus('disconnected', 'Disconnected');
        // 취소된 경우 에러 메시지 표시 안함
        if (result.error !== 'Connection cancelled') {
          this.showError(result.error);
        }
        this.startBtn.disabled = false;
        this.stopBtn.disabled = true;
      }
    } catch (error) {
      clearTimeout(timeoutId);

      // 타임아웃 시 백그라운드에서 연결 정리
      if (isTimedOut) {
        window.kafkaAPI.stopConsumer(this.tabId).catch(() => {});
      }

      this.updateStatus('disconnected', 'Disconnected');
      this.showError(error.message);
      this.startBtn.disabled = false;
      this.stopBtn.disabled = true;
    }
  }

  async stopConsumer() {
    // UI 상태 즉시 변경 (IPC 응답 기다리지 않음)
    this.isConsuming = false;
    this.updateStatus('disconnected', 'Disconnected');
    this.startBtn.disabled = false;
    this.stopBtn.disabled = true;

    // 백그라운드에서 실제 종료 처리 (fire-and-forget)
    window.kafkaAPI.stopConsumer(this.tabId).catch(error => {
      console.error('Consumer stop error:', error.message);
    });
  }

  updateStatus(status, text) {
    this.statusIndicator.className = `status-indicator ${status}`;
    this.statusText.textContent = text;
  }

  addMessage(message) {
    this.messages.push(message);
    this.applyFilterAndEnforceLimit();
  }

  // 필터 적용 및 메시지 제한을 한번에 처리 (렌더링 중복 방지)
  applyFilterAndEnforceLimit() {
    // 1. 필터 적용
    const filterText = this.filterInput.value.trim();
    const valueFilterText = this.valueFilterInput.value.trim();

    this.extractedValues.clear();
    this.activeValueFilter = null;

    let filtered = [...this.messages];

    // 키워드 필터
    if (filterText) {
      const keyword = filterText.toLowerCase();
      filtered = filtered.filter(msg =>
        (msg.key && msg.key.toLowerCase().includes(keyword)) ||
        (msg.value && msg.value.toLowerCase().includes(keyword))
      );
    }

    // JSONPath 필터
    if (valueFilterText && valueFilterText.startsWith('$')) {
      this.activeValueFilter = valueFilterText;
      filtered = filtered.filter(msg => {
        try {
          const parsed = JSON.parse(msg.value);
          const comparisonMatch = valueFilterText.match(/^(.+?)\s*(==|!=|>|<|>=|<=)\s*(.+)$/);
          if (comparisonMatch) {
            const [, jsonPath] = comparisonMatch;
            const result = JSONPathEvaluator.evaluate(parsed, valueFilterText);
            if (result) {
              const extractedValue = JSONPathEvaluator.getValueByPath(parsed, jsonPath.trim());
              const msgKey = `${msg.partition}-${msg.offset}`;
              this.extractedValues.set(msgKey, this.formatExtractedValue(extractedValue));
            }
            return result;
          }
          const extractedValue = JSONPathEvaluator.getValueByPath(parsed, valueFilterText);
          if (extractedValue !== undefined && extractedValue !== null) {
            const msgKey = `${msg.partition}-${msg.offset}`;
            this.extractedValues.set(msgKey, this.formatExtractedValue(extractedValue));
            return true;
          }
          return false;
        } catch {
          return false;
        }
      });
    }

    this.filteredMessages = filtered;

    // 2. 메시지 제한 적용 (필터 상태에 따라 다르게 동작)
    const hasFilter = filterText || (valueFilterText && valueFilterText.startsWith('$'));

    if (hasFilter) {
      // 필터가 있으면: 필터된 메시지 수가 maxMessages를 초과할 때만 원본 메시지 정리
      while (this.filteredMessages.length > this.maxMessages && this.messages.length > 0) {
        const oldestMsg = this.messages.shift();
        const idx = this.filteredMessages.findIndex(m =>
          m.partition === oldestMsg.partition && m.offset === oldestMsg.offset
        );
        if (idx !== -1) {
          this.filteredMessages.splice(idx, 1);
          const msgKey = `${oldestMsg.partition}-${oldestMsg.offset}`;
          this.extractedValues.delete(msgKey);
        }
      }
    } else {
      // 필터가 없으면: 전체 메시지 수 기준으로 제한
      while (this.messages.length > this.maxMessages) {
        this.messages.shift();
      }
      this.filteredMessages = [...this.messages];
    }

    // 3. 렌더링 (한 번만 호출)
    this.renderMessages();
    this.updateMessageCount();
  }

  applyFilter() {
    // 사용자가 필터 입력을 변경했을 때 호출됨
    // 필터 적용 및 제한 로직을 재사용
    this.applyFilterAndEnforceLimit();
  }

  // 추출된 값 포맷팅
  formatExtractedValue(value) {
    if (value === null) return 'null';
    if (value === undefined) return 'undefined';
    if (typeof value === 'object') {
      return JSON.stringify(value);
    }
    return String(value);
  }

  renderMessages() {
    // 역순으로 표시 (최신 메시지가 위로)
    const reversedMessages = [...this.filteredMessages].reverse();

    this.messagesBody.innerHTML = reversedMessages.map((msg, index) => {
      const timestamp = new Date(parseInt(msg.timestamp)).toLocaleString('ko-KR');
      const msgKey = `${msg.partition}-${msg.offset}`;

      // JSONPath 필터가 활성화되어 있으면 추출된 값 표시
      let displayValue;
      let isExtracted = false;
      if (this.activeValueFilter && this.extractedValues.has(msgKey)) {
        displayValue = this.extractedValues.get(msgKey);
        isExtracted = true;
      } else {
        displayValue = this.truncateValue(msg.value, 100);
      }

      const extractedClass = isExtracted ? 'extracted-value' : '';

      return `
        <tr data-index="${this.filteredMessages.length - 1 - index}">
          <td>${timestamp}</td>
          <td>${msg.partition || '-'}</td>
          <td>${msg.offset || '-'}</td>
          <td>${this.escapeHtml(msg.key || '-')}</td>
          <td class="value-cell ${extractedClass}" title="${this.escapeHtml(msg.value)}">${this.escapeHtml(displayValue)}</td>
        </tr>
      `;
    }).join('');

    // 행 클릭 이벤트
    this.messagesBody.querySelectorAll('tr').forEach(row => {
      row.addEventListener('click', () => {
        const index = parseInt(row.dataset.index);
        this.showMessageDetail(this.filteredMessages[index]);
      });
    });
  }

  truncateValue(value, maxLength) {
    if (!value) return '';
    return value.length > maxLength ? value.substring(0, maxLength) + '...' : value;
  }

  escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  showMessageDetail(message) {
    const modal = document.getElementById('message-modal');
    const timestamp = new Date(parseInt(message.timestamp)).toLocaleString('ko-KR');

    document.getElementById('modal-timestamp').textContent = timestamp;
    document.getElementById('modal-partition').textContent = message.partition || '-';
    document.getElementById('modal-offset').textContent = message.offset || '-';
    document.getElementById('modal-key').textContent = message.key || '-';

    const modalValue = document.getElementById('modal-value');

    // JSON 포맷팅 시도
    try {
      const parsed = JSON.parse(message.value);
      // 인터랙티브 JSON 렌더링
      modalValue.innerHTML = '';
      modalValue.appendChild(this.renderInteractiveJson(parsed, '$'));
    } catch {
      // JSON이 아니면 원본 그대로
      modalValue.textContent = message.value;
    }

    modal.classList.remove('hidden');

    // 모달 닫기
    const closeModal = () => {
      modal.classList.add('hidden');
      modal.removeEventListener('click', handleClick);
      // 툴팁 제거
      const tooltip = document.querySelector('.jsonpath-tooltip');
      if (tooltip) tooltip.remove();
    };

    const handleClick = (e) => {
      if (e.target === modal || e.target.classList.contains('modal-close')) {
        closeModal();
      }
    };

    modal.addEventListener('click', handleClick);
  }

  // 인터랙티브 JSON 렌더링
  renderInteractiveJson(obj, path = '$', indent = 0) {
    const container = document.createElement('span');

    if (obj === null) {
      container.innerHTML = '<span class="json-null">null</span>';
      return container;
    }

    if (typeof obj === 'boolean') {
      container.innerHTML = `<span class="json-boolean">${obj}</span>`;
      return container;
    }

    if (typeof obj === 'number') {
      container.innerHTML = `<span class="json-number">${obj}</span>`;
      return container;
    }

    if (typeof obj === 'string') {
      container.innerHTML = `<span class="json-string">"${this.escapeHtml(obj)}"</span>`;
      return container;
    }

    if (Array.isArray(obj)) {
      if (obj.length === 0) {
        container.textContent = '[]';
        return container;
      }

      container.appendChild(document.createTextNode('[\n'));

      obj.forEach((item, index) => {
        const itemPath = `${path}[${index}]`;
        const indentStr = '  '.repeat(indent + 1);

        container.appendChild(document.createTextNode(indentStr));

        // 인덱스를 클릭 가능한 요소로 표시
        const indexEl = document.createElement('span');
        indexEl.className = 'json-index';
        indexEl.dataset.jsonpath = itemPath;
        indexEl.textContent = `[${index}]`;
        indexEl.addEventListener('click', (e) => this.showJsonPathTooltip(e, itemPath));
        container.appendChild(indexEl);

        container.appendChild(document.createTextNode(': '));
        container.appendChild(this.renderInteractiveJson(item, itemPath, indent + 1));

        if (index < obj.length - 1) {
          container.appendChild(document.createTextNode(','));
        }
        container.appendChild(document.createTextNode('\n'));
      });

      container.appendChild(document.createTextNode('  '.repeat(indent) + ']'));
      return container;
    }

    if (typeof obj === 'object') {
      const keys = Object.keys(obj);
      if (keys.length === 0) {
        container.textContent = '{}';
        return container;
      }

      container.appendChild(document.createTextNode('{\n'));

      keys.forEach((key, index) => {
        const keyPath = `${path}.${key}`;
        const indentStr = '  '.repeat(indent + 1);

        container.appendChild(document.createTextNode(indentStr));

        // 키를 클릭 가능한 요소로 표시
        const keyEl = document.createElement('span');
        keyEl.className = 'json-key';
        keyEl.dataset.jsonpath = keyPath;
        keyEl.textContent = `"${key}"`;
        keyEl.addEventListener('click', (e) => this.showJsonPathTooltip(e, keyPath));
        container.appendChild(keyEl);

        container.appendChild(document.createTextNode(': '));
        container.appendChild(this.renderInteractiveJson(obj[key], keyPath, indent + 1));

        if (index < keys.length - 1) {
          container.appendChild(document.createTextNode(','));
        }
        container.appendChild(document.createTextNode('\n'));
      });

      container.appendChild(document.createTextNode('  '.repeat(indent) + '}'));
      return container;
    }

    container.textContent = String(obj);
    return container;
  }

  // JSONPath 툴팁 표시
  showJsonPathTooltip(event, jsonPath) {
    event.stopPropagation();

    // 기존 툴팁 제거
    const existingTooltip = document.querySelector('.jsonpath-tooltip');
    if (existingTooltip) existingTooltip.remove();

    // 툴팁 생성
    const tooltip = document.createElement('div');
    tooltip.className = 'jsonpath-tooltip';
    tooltip.innerHTML = `
      <span class="jsonpath-text">${jsonPath}</span>
      <button class="jsonpath-copy-btn">Copy</button>
      <button class="jsonpath-filter-btn">Filter</button>
    `;

    // 위치 설정
    tooltip.style.position = 'fixed';
    tooltip.style.left = `${event.clientX + 10}px`;
    tooltip.style.top = `${event.clientY - 10}px`;

    document.body.appendChild(tooltip);

    // 복사 버튼 핸들러
    tooltip.querySelector('.jsonpath-copy-btn').addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(jsonPath);
        tooltip.querySelector('.jsonpath-copy-btn').textContent = 'Copied!';
        setTimeout(() => tooltip.remove(), 1000);
      } catch (err) {
        console.error('Failed to copy:', err);
      }
    });

    // 필터 버튼 핸들러 (Value JSONPath 필터에 적용)
    tooltip.querySelector('.jsonpath-filter-btn').addEventListener('click', () => {
      this.valueFilterInput.value = jsonPath;
      this.applyFilter();
      tooltip.remove();
      // 모달 닫기
      document.getElementById('message-modal').classList.add('hidden');
    });

    // 외부 클릭 시 툴팁 닫기
    const closeTooltip = (e) => {
      if (!tooltip.contains(e.target)) {
        tooltip.remove();
        document.removeEventListener('click', closeTooltip);
      }
    };
    setTimeout(() => document.addEventListener('click', closeTooltip), 0);
  }

  updateMessageCount() {
    const total = this.messages.length;
    const filtered = this.filteredMessages.length;

    if (total === filtered) {
      this.messageCount.textContent = `Messages: ${total}`;
    } else {
      this.messageCount.textContent = `Messages: ${filtered} / ${total}`;
    }
  }

  clearMessages() {
    this.messages = [];
    this.filteredMessages = [];
    this.extractedValues.clear();
    this.activeValueFilter = null;
    this.renderMessages();
    this.updateMessageCount();
  }

  async exportMessages(format) {
    this.exportMenu.classList.add('hidden');

    if (this.filteredMessages.length === 0) {
      this.showError('Export할 메시지가 없습니다.');
      return;
    }

    try {
      const result = await window.kafkaAPI.exportMessages(this.filteredMessages, format);

      if (result.success) {
        this.showSuccess(`Exported to ${result.filePath}`);
      } else if (!result.canceled) {
        this.showError(result.error);
      }
    } catch (error) {
      this.showError(error.message);
    }
  }

  async sendMessage() {
    const broker = this.brokerInput.value.trim();
    const topic = this.topicInput.value.trim();
    const key = this.producerKeyInput.value.trim();
    const value = this.producerValueInput.value;

    if (!broker || !topic) {
      this.showError('Broker와 Topic을 입력해주세요.');
      return;
    }

    if (!value) {
      this.showError('메시지 Value를 입력해주세요.');
      return;
    }

    this.sendBtn.disabled = true;
    this.sendStatus.textContent = 'Sending...';
    this.sendStatus.className = 'send-status';

    try {
      let result;

      if (this.repeatCheckbox.checked) {
        const intervalMs = parseInt(this.repeatIntervalInput.value) || 1000;
        const count = parseInt(this.repeatCountInput.value) || 10;

        result = await window.kafkaAPI.sendMessageRepeat({
          broker,
          topic,
          key: key || null,
          value,
          intervalMs,
          count
        });

        if (result.success) {
          this.sendStatus.textContent = `Sent ${result.sentCount} messages`;
          this.sendStatus.className = 'send-status success';
        } else {
          this.sendStatus.textContent = `Failed after ${result.sentCount} messages: ${result.error}`;
          this.sendStatus.className = 'send-status error';
        }
      } else {
        result = await window.kafkaAPI.sendMessage({
          broker,
          topic,
          key: key || null,
          value
        });

        if (result.success) {
          this.sendStatus.textContent = 'Message sent successfully';
          this.sendStatus.className = 'send-status success';
        } else {
          this.sendStatus.textContent = `Error: ${result.error}`;
          this.sendStatus.className = 'send-status error';
        }
      }
    } catch (error) {
      this.sendStatus.textContent = `Error: ${error.message}`;
      this.sendStatus.className = 'send-status error';
    } finally {
      this.sendBtn.disabled = false;

      // 3초 후 상태 메시지 클리어
      setTimeout(() => {
        this.sendStatus.textContent = '';
        this.sendStatus.className = 'send-status';
      }, 3000);
    }
  }

  showError(message) {
    // 간단한 에러 표시 (나중에 토스트로 개선 가능)
    alert(`Error: ${message}`);
  }

  showSuccess(message) {
    alert(message);
  }

  async cleanup() {
    // 설정 리스너 제거
    settingsManager.removeListener(this.onSettingsChange);

    if (this.isConsuming) {
      this.stopConsumer(); // fire-and-forget
    }
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  const tabManager = new TabManager();

  // Settings 모달 설정
  const settingsBtn = document.getElementById('settings-btn');
  const settingsModal = document.getElementById('settings-modal');
  const maxMessagesInput = document.getElementById('max-messages-input');
  const settingsSaveBtn = document.getElementById('settings-save-btn');
  const settingsCancelBtn = document.getElementById('settings-cancel-btn');

  if (settingsBtn && settingsModal) {
    const openSettingsModal = () => {
      maxMessagesInput.value = settingsManager.getMaxMessages();
      settingsModal.classList.remove('hidden');
    };

    const closeSettingsModal = () => {
      settingsModal.classList.add('hidden');
    };

    const saveSettings = () => {
      const value = parseInt(maxMessagesInput.value, 10);

      if (isNaN(value) || value < 10 || value > 100000) {
        maxMessagesInput.style.borderColor = 'var(--danger)';
        return;
      }

      maxMessagesInput.style.borderColor = '';
      settingsManager.saveSettings({ maxMessages: value });
      closeSettingsModal();
    };

    settingsBtn.addEventListener('click', openSettingsModal);
    settingsSaveBtn.addEventListener('click', saveSettings);
    settingsCancelBtn.addEventListener('click', closeSettingsModal);

    // 백드롭 클릭 시 닫기
    settingsModal.addEventListener('click', (e) => {
      if (e.target === settingsModal || e.target.classList.contains('modal-close')) {
        closeSettingsModal();
      }
    });

    // ESC 키로 닫기
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !settingsModal.classList.contains('hidden')) {
        closeSettingsModal();
      }
    });

    // Enter 키로 저장
    maxMessagesInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveSettings();
      }
    });
  }

  // Kafka CLI 도구 확인
  try {
    const result = await window.kafkaAPI.checkKafkaTools();
    const { tools } = result;
    const hasAllTools = Object.values(tools).every(v => v);

    if (!hasAllTools) {
      const warningBanner = document.getElementById('kafka-tools-warning');
      const missingTools = Object.entries(tools)
        .filter(([_, installed]) => !installed)
        .map(([tool]) => tool)
        .join(', ');

      warningBanner.querySelector('.warning-text').textContent =
        `Kafka CLI 도구가 PATH에 설치되어 있지 않습니다: ${missingTools}`;
      warningBanner.classList.remove('hidden');
    }
  } catch (error) {
    console.error('Failed to check Kafka tools:', error);
  }
});
