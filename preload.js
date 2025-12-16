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
  cancelRepeatSend: (sendId) => ipcRenderer.invoke('cancel-repeat-send', sendId),
  onSendProgress: (callback) => {
    ipcRenderer.on('send-progress', (event, progress) => callback(progress));
  },
  removeSendProgressListener: () => {
    ipcRenderer.removeAllListeners('send-progress');
  },

  // Export 관련
  exportMessages: (messages, format) => ipcRenderer.invoke('export-messages', messages, format),

  // 토픽 존재 여부 확인
  checkTopicExists: (data) => ipcRenderer.invoke('check-topic-exists', data),

  // Kafka CLI 도구 확인
  checkKafkaTools: () => ipcRenderer.invoke('check-kafka-tools'),

  // Util 관련
  getBrokerStatus: (broker) => ipcRenderer.invoke('get-broker-status', broker),
  getTopicsList: (broker) => ipcRenderer.invoke('get-topics-list', broker),
  getConsumerGroups: (broker) => ipcRenderer.invoke('get-consumer-groups', broker),
  getClusterInfo: (broker) => ipcRenderer.invoke('get-cluster-info', broker)
});
