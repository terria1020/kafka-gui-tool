const { app, BrowserWindow, ipcMain, dialog, Menu, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Kafka } = require('kafkajs');

// 멀티 인스턴스 지원을 위해 single instance lock 사용하지 않음
// 사용자가 여러 창을 열 수 있도록 허용

// Kafka 매니저 클래스들
class KafkaConsumerManager {
  constructor() {
    this.consumers = new Map();
    this.kafkaInstances = new Map();
    this.pendingConnections = new Map(); // 진행 중인 연결 추적
  }

  async createConsumer(consumerId, broker, topic, groupId, mainWindow) {
    // 진행 중인 연결이 있으면 먼저 취소
    if (this.pendingConnections.has(consumerId)) {
      this.pendingConnections.get(consumerId).cancelled = true;
      this.pendingConnections.delete(consumerId);
    }

    // 기존 consumer가 있으면 먼저 정리
    if (this.consumers.has(consumerId)) {
      await this.stopConsumer(consumerId);
    }

    // 연결 상태 추적 객체
    const connectionState = { cancelled: false };
    this.pendingConnections.set(consumerId, connectionState);

    try {
      // 브로커 목록 파싱 (쉼표로 구분된 여러 브로커 지원)
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: `kafka-gui-${consumerId}`,
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 30000,
      });

      const consumer = kafka.consumer({
        groupId: groupId || `kafka-gui-group-${consumerId}-${Date.now()}`
      });

      // 연결 시도
      await consumer.connect();

      // 연결 중 취소 요청이 들어왔는지 확인
      if (connectionState.cancelled) {
        consumer.disconnect().catch(() => {});
        return { success: false, error: 'Connection cancelled' };
      }

      await consumer.subscribe({ topic, fromBeginning: false });

      // 구독 중 취소 요청 확인
      if (connectionState.cancelled) {
        consumer.disconnect().catch(() => {});
        return { success: false, error: 'Connection cancelled' };
      }

      // consumer를 먼저 등록하여 eachMessage에서 확인할 수 있도록 함
      this.consumers.set(consumerId, consumer);
      this.kafkaInstances.set(consumerId, kafka);

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          // consumer가 여전히 활성 상태인지 확인
          if (!this.consumers.has(consumerId)) return;

          // 창이 여전히 유효한지 확인
          if (!mainWindow || mainWindow.isDestroyed()) return;

          const messageData = {
            consumerId,
            timestamp: message.timestamp,
            partition,
            offset: message.offset,
            key: message.key?.toString() || '',
            value: message.value?.toString() || '',
            headers: message.headers || {}
          };

          try {
            mainWindow.webContents.send('kafka-message', messageData);
          } catch (err) {
            console.error('Failed to send message to window:', err.message);
          }
        }
      });

      // 최종 취소 확인
      if (connectionState.cancelled) {
        this.consumers.delete(consumerId);
        this.kafkaInstances.delete(consumerId);
        consumer.disconnect().catch(() => {});
        return { success: false, error: 'Connection cancelled' };
      }

      this.pendingConnections.delete(consumerId);

      return { success: true };
    } catch (error) {
      this.pendingConnections.delete(consumerId);

      // 연결이 취소된 경우
      if (connectionState.cancelled) {
        return { success: false, error: 'Connection cancelled' };
      }

      console.error('Consumer creation error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopConsumer(consumerId, force = true) {
    try {
      // 진행 중인 연결 취소
      if (this.pendingConnections.has(consumerId)) {
        this.pendingConnections.get(consumerId).cancelled = true;
        this.pendingConnections.delete(consumerId);
      }

      const consumer = this.consumers.get(consumerId);
      if (consumer) {
        // 참조를 먼저 삭제하여 즉시 응답
        this.consumers.delete(consumerId);
        this.kafkaInstances.delete(consumerId);

        if (force) {
          // Fire-and-forget: 백그라운드에서 disconnect 실행
          consumer.disconnect().catch(err => {
            console.log('Background disconnect completed:', err?.message || 'success');
          });
        } else {
          // Graceful shutdown
          await consumer.disconnect();
        }
      }
      return { success: true };
    } catch (error) {
      console.error('Consumer stop error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopAll() {
    // 모든 진행 중인 연결 취소
    for (const state of this.pendingConnections.values()) {
      state.cancelled = true;
    }
    this.pendingConnections.clear();

    for (const consumerId of this.consumers.keys()) {
      await this.stopConsumer(consumerId);
    }
  }
}

class KafkaProducerManager {
  constructor() {
    this.producers = new Map();
    this.kafkaInstances = new Map();
  }

  async getProducer(broker) {
    if (this.producers.has(broker)) {
      return this.producers.get(broker);
    }

    // 브로커 목록 파싱 (쉼표로 구분된 여러 브로커 지원)
    const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

    const kafka = new Kafka({
      clientId: 'kafka-gui-producer',
      brokers: brokerList,
      connectionTimeout: 10000,
      requestTimeout: 30000,
    });

    const producer = kafka.producer();
    await producer.connect();

    this.producers.set(broker, producer);
    this.kafkaInstances.set(broker, kafka);

    return producer;
  }

  async sendMessage(broker, topic, key, value) {
    try {
      const producer = await this.getProducer(broker);

      const messages = [{
        key: key || null,
        value: value
      }];

      await producer.send({
        topic,
        messages
      });

      return { success: true };
    } catch (error) {
      console.error('Producer send error:', error);
      // 에러 발생 시 producer 캐시 제거하여 다음 전송 시 재연결
      this.producers.delete(broker);
      this.kafkaInstances.delete(broker);
      return { success: false, error: error.message };
    }
  }

  async disconnectAll() {
    for (const producer of this.producers.values()) {
      await producer.disconnect();
    }
    this.producers.clear();
    this.kafkaInstances.clear();
  }
}

// 전역 매니저 인스턴스
let consumerManager;
let producerManager;
const windows = new Set(); // 모든 창 추적
const repeatSendCancelled = new Map(); // 반복 전송 취소 상태 추적

function createWindow() {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 800,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  windows.add(win);

  win.on('closed', () => {
    windows.delete(win);
  });

  win.loadFile('index.html');

  // 개발 시 DevTools 열기
  // win.webContents.openDevTools();

  return win;
}

// IPC 핸들러 등록
function setupIpcHandlers() {
  consumerManager = new KafkaConsumerManager();
  producerManager = new KafkaProducerManager();

  // Consumer 시작
  ipcMain.handle('start-consumer', async (event, config) => {
    const { consumerId, broker, topic, groupId } = config;
    // 요청을 보낸 창 찾기
    const senderWindow = BrowserWindow.fromWebContents(event.sender);
    return await consumerManager.createConsumer(consumerId, broker, topic, groupId, senderWindow);
  });

  // Consumer 중지
  ipcMain.handle('stop-consumer', async (event, consumerId) => {
    return await consumerManager.stopConsumer(consumerId);
  });

  // 메시지 전송
  ipcMain.handle('send-message', async (event, data) => {
    const { broker, topic, key, value } = data;
    return await producerManager.sendMessage(broker, topic, key, value);
  });

  // 반복 메시지 전송
  ipcMain.handle('send-message-repeat', async (event, data) => {
    const { broker, topic, key, value, intervalMs, count, sendId } = data;
    const senderWindow = BrowserWindow.fromWebContents(event.sender);

    // 취소 상태 초기화
    repeatSendCancelled.set(sendId, false);

    for (let i = 0; i < count; i++) {
      // 취소 요청 확인
      if (repeatSendCancelled.get(sendId)) {
        repeatSendCancelled.delete(sendId);
        return { success: false, cancelled: true, sentCount: i };
      }

      const result = await producerManager.sendMessage(broker, topic, key, value);
      const now = new Date();
      const timeStr = now.toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });

      // 전송 진행 상황을 renderer에 알림
      if (senderWindow && !senderWindow.isDestroyed()) {
        senderWindow.webContents.send('send-progress', {
          sendId,
          index: i + 1,
          total: count,
          time: timeStr,
          success: result.success,
          error: result.error
        });
      }

      if (!result.success) {
        repeatSendCancelled.delete(sendId);
        return { success: false, error: result.error, sentCount: i };
      }

      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    repeatSendCancelled.delete(sendId);
    return { success: true, sentCount: count };
  });

  // 반복 전송 취소
  ipcMain.handle('cancel-repeat-send', async (event, sendId) => {
    repeatSendCancelled.set(sendId, true);
    return { success: true };
  });

  // 메시지 Export
  ipcMain.handle('export-messages', async (event, messages, format) => {
    try {
      const options = {
        title: 'Export Messages',
        defaultPath: `kafka-messages-${Date.now()}.${format}`,
        filters: [
          format === 'json'
            ? { name: 'JSON Files', extensions: ['json'] }
            : { name: 'Text Files', extensions: ['txt'] }
        ]
      };

      const { filePath, canceled } = await dialog.showSaveDialog(mainWindow, options);

      if (canceled || !filePath) {
        return { success: false, canceled: true };
      }

      let content;
      if (format === 'json') {
        content = JSON.stringify(messages, null, 2);
      } else {
        content = messages.map(m =>
          `[${new Date(parseInt(m.timestamp)).toISOString()}] ${m.key || ''}: ${m.value}`
        ).join('\n');
      }

      fs.writeFileSync(filePath, content, 'utf-8');
      return { success: true, filePath };
    } catch (error) {
      console.error('Export error:', error);
      return { success: false, error: error.message };
    }
  });

  // 토픽 존재 여부 확인
  ipcMain.handle('check-topic-exists', async (event, data) => {
    const { broker, topic } = data;

    try {
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: 'kafka-gui-topic-checker',
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 10000,
      });

      const admin = kafka.admin();
      await admin.connect();

      const topics = await admin.listTopics();
      const exists = topics.includes(topic);

      await admin.disconnect();

      return { success: true, exists, topics };
    } catch (error) {
      console.error('Topic check error:', error);
      return { success: false, error: error.message };
    }
  });

  // Kafka CLI 도구 확인 (패키징된 앱에서도 동작하도록 직접 경로 탐색)
  ipcMain.handle('check-kafka-tools', async () => {
    const os = require('os');

    // 일반적인 Kafka 도구 설치 경로들
    const searchPaths = [
      '/opt/homebrew/bin',              // Homebrew Apple Silicon
      '/usr/local/bin',                 // Homebrew Intel / 일반
      '/usr/local/confluent/bin',       // Confluent Platform
      '/opt/kafka/bin',                 // 수동 설치
      '/usr/local/kafka/bin',           // 수동 설치
      path.join(os.homedir(), 'kafka/bin'),  // 사용자 홈
      '/usr/bin',                       // 시스템
    ];

    // 도구 이름 변형 (.sh 확장자 포함)
    const toolVariants = {
      'kafka-console-consumer': ['kafka-console-consumer', 'kafka-console-consumer.sh'],
      'kafka-console-producer': ['kafka-console-producer', 'kafka-console-producer.sh']
    };

    const tools = {
      'kafka-console-consumer': false,
      'kafka-console-producer': false
    };

    const toolPaths = {
      'kafka-console-consumer': null,
      'kafka-console-producer': null
    };

    for (const [toolKey, variants] of Object.entries(toolVariants)) {
      for (const searchPath of searchPaths) {
        if (tools[toolKey]) break; // 이미 찾았으면 스킵

        for (const variant of variants) {
          const fullPath = path.join(searchPath, variant);

          try {
            await fs.promises.access(fullPath, fs.constants.X_OK);
            tools[toolKey] = true;
            toolPaths[toolKey] = fullPath;
            break;
          } catch {
            // 파일 없음 또는 실행 권한 없음
          }
        }
      }
    }

    return { tools, paths: toolPaths };
  });

  // Util: Broker 상태 확인
  ipcMain.handle('get-broker-status', async (event, broker) => {
    try {
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: 'kafka-gui-util',
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 10000,
      });

      const admin = kafka.admin();
      await admin.connect();

      const cluster = await admin.describeCluster();
      await admin.disconnect();

      return {
        success: true,
        brokers: cluster.brokers,
        controller: cluster.controller,
        clusterId: cluster.clusterId
      };
    } catch (error) {
      console.error('Broker status error:', error);
      return { success: false, error: error.message };
    }
  });

  // Util: 토픽 목록 조회
  ipcMain.handle('get-topics-list', async (event, broker) => {
    try {
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: 'kafka-gui-util',
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 10000,
      });

      const admin = kafka.admin();
      await admin.connect();

      const topics = await admin.listTopics();
      const topicMetadata = await admin.fetchTopicMetadata({ topics });

      await admin.disconnect();

      return {
        success: true,
        topics: topicMetadata.topics.map(t => ({
          name: t.name,
          partitions: t.partitions.length
        }))
      };
    } catch (error) {
      console.error('Topics list error:', error);
      return { success: false, error: error.message };
    }
  });

  // Util: 소비 그룹 목록 조회
  ipcMain.handle('get-consumer-groups', async (event, broker) => {
    try {
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: 'kafka-gui-util',
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 10000,
      });

      const admin = kafka.admin();
      await admin.connect();

      const groups = await admin.listGroups();
      await admin.disconnect();

      return {
        success: true,
        groups: groups.groups.map(g => ({
          groupId: g.groupId,
          protocolType: g.protocolType
        }))
      };
    } catch (error) {
      console.error('Consumer groups error:', error);
      return { success: false, error: error.message };
    }
  });

  // Util: 클러스터 정보 조회
  ipcMain.handle('get-cluster-info', async (event, broker) => {
    try {
      const brokerList = broker.split(',').map(b => b.trim()).filter(b => b);

      const kafka = new Kafka({
        clientId: 'kafka-gui-util',
        brokers: brokerList,
        connectionTimeout: 10000,
        requestTimeout: 10000,
      });

      const admin = kafka.admin();
      await admin.connect();

      const cluster = await admin.describeCluster();
      await admin.disconnect();

      return {
        success: true,
        clusterId: cluster.clusterId,
        controller: cluster.controller,
        brokers: cluster.brokers
      };
    } catch (error) {
      console.error('Cluster info error:', error);
      return { success: false, error: error.message };
    }
  });
}

// 메뉴 템플릿 생성
function createMenu() {
  const isMac = process.platform === 'darwin';

  const template = [
    // 앱 메뉴 (macOS만)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'services' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    // 파일 메뉴
    {
      label: '파일',
      submenu: [
        {
          label: '새 창',
          accelerator: isMac ? 'Cmd+Shift+N' : 'Ctrl+Shift+N',
          click: () => createWindow()
        },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' }
      ]
    },
    // 편집 메뉴
    {
      label: '편집',
      submenu: [
        { role: 'undo' },
        { role: 'redo' },
        { type: 'separator' },
        { role: 'cut' },
        { role: 'copy' },
        { role: 'paste' },
        { role: 'selectAll' }
      ]
    },
    // 보기 메뉴
    {
      label: '보기',
      submenu: [
        { role: 'reload' },
        { role: 'forceReload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    // 창 메뉴
    {
      label: '창',
      submenu: [
        { role: 'minimize' },
        { role: 'zoom' },
        ...(isMac ? [
          { type: 'separator' },
          { role: 'front' },
          { type: 'separator' },
          { role: 'window' }
        ] : [
          { role: 'close' }
        ])
      ]
    }
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

app.whenReady().then(() => {
  setupIpcHandlers();
  createMenu();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', async () => {
  // 모든 Kafka 연결 정리
  if (consumerManager) {
    await consumerManager.stopAll();
  }
  if (producerManager) {
    await producerManager.disconnectAll();
  }

  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  if (consumerManager) {
    await consumerManager.stopAll();
  }
  if (producerManager) {
    await producerManager.disconnectAll();
  }
});
