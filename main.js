const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const { Kafka } = require('kafkajs');

// Kafka 매니저 클래스들
class KafkaConsumerManager {
  constructor() {
    this.consumers = new Map();
    this.kafkaInstances = new Map();
  }

  async createConsumer(consumerId, broker, topic, groupId, mainWindow) {
    try {
      // 기존 consumer가 있으면 먼저 정리
      if (this.consumers.has(consumerId)) {
        await this.stopConsumer(consumerId);
      }

      const kafka = new Kafka({
        clientId: `kafka-gui-${consumerId}`,
        brokers: [broker],
        connectionTimeout: 10000,
        requestTimeout: 30000,
      });

      const consumer = kafka.consumer({
        groupId: groupId || `kafka-gui-group-${consumerId}-${Date.now()}`
      });

      await consumer.connect();
      await consumer.subscribe({ topic, fromBeginning: false });

      await consumer.run({
        eachMessage: async ({ topic, partition, message }) => {
          const messageData = {
            consumerId,
            timestamp: message.timestamp,
            partition,
            offset: message.offset,
            key: message.key?.toString() || '',
            value: message.value?.toString() || '',
            headers: message.headers || {}
          };
          mainWindow.webContents.send('kafka-message', messageData);
        }
      });

      this.consumers.set(consumerId, consumer);
      this.kafkaInstances.set(consumerId, kafka);

      return { success: true };
    } catch (error) {
      console.error('Consumer creation error:', error);
      return { success: false, error: error.message };
    }
  }

  async stopConsumer(consumerId, force = true) {
    try {
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

    const kafka = new Kafka({
      clientId: 'kafka-gui-producer',
      brokers: [broker],
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
let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile('index.html');

  // 개발 시 DevTools 열기
  // mainWindow.webContents.openDevTools();
}

// IPC 핸들러 등록
function setupIpcHandlers() {
  consumerManager = new KafkaConsumerManager();
  producerManager = new KafkaProducerManager();

  // Consumer 시작
  ipcMain.handle('start-consumer', async (event, config) => {
    const { consumerId, broker, topic, groupId } = config;
    return await consumerManager.createConsumer(consumerId, broker, topic, groupId, mainWindow);
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
    const { broker, topic, key, value, intervalMs, count } = data;
    const results = [];

    for (let i = 0; i < count; i++) {
      const result = await producerManager.sendMessage(broker, topic, key, value);
      results.push(result);

      if (!result.success) {
        return { success: false, error: result.error, sentCount: i };
      }

      if (i < count - 1) {
        await new Promise(resolve => setTimeout(resolve, intervalMs));
      }
    }

    return { success: true, sentCount: count };
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
}

app.whenReady().then(() => {
  setupIpcHandlers();
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
