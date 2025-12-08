const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kafkaAPI', {
  // Consumer 관련
  startConsumer: (config) => ipcRenderer.invoke('start-consumer', config),
  stopConsumer: (consumerId) => ipcRenderer.invoke('stop-consumer', consumerId),
  onMessage: (callback) => {
    ipcRenderer.on('kafka-message', (event, message) => callback(message));
  },
  removeMessageListener: () => {
    ipcRenderer.removeAllListeners('kafka-message');
  },

  // Producer 관련
  sendMessage: (data) => ipcRenderer.invoke('send-message', data),
  sendMessageRepeat: (data) => ipcRenderer.invoke('send-message-repeat', data),

  // Export 관련
  exportMessages: (messages, format) => ipcRenderer.invoke('export-messages', messages, format),

  // Kafka CLI 도구 확인
  checkKafkaTools: () => ipcRenderer.invoke('check-kafka-tools')
});
