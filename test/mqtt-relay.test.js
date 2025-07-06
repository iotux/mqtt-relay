const assert = require('assert');
const sinon = require('sinon');
const proxyquire = require('proxyquire');

// Mock MQTT client
class MockMqttClient {
  constructor() {
    this.listeners = {};
    this.publishedMessages = [];
    this.subscriptions = new Set();
    this.ended = false;
    this.connected = false; // Add connected state
  }

  on(event, callback) {
    this.listeners[event] = callback;
  }

  emit(event, ...args) {
    if (event === 'connect') {
      this.connected = true;
    } else if (event === 'close' || event === 'offline') {
      this.connected = false;
    }
    if (this.listeners[event]) {
      this.listeners[event](...args);
    }
  }

  publish(topic, message, options) {
    this.publishedMessages.push({ topic, message: message.toString(), options });
  }

  subscribe(topic, options, callback) {
    // Handle cases where options might be omitted and callback is the second argument
    if (typeof options === 'function') {
      callback = options;
      options = {};
    }

    const topicsToSubscribe = Array.isArray(topic) ? topic : [topic];
    topicsToSubscribe.forEach(t => this.subscriptions.add(t));

    // Simulate granted array for the callback
    const granted = topicsToSubscribe.map(t => ({ topic: t, qos: (options && options.qos) || 0 }));
    if (callback) callback(null, granted);
  }

  unsubscribe(topic, callback) {
    const topicsToUnsubscribe = Array.isArray(topic) ? topic : [topic];
    topicsToUnsubscribe.forEach(t => this.subscriptions.delete(t));
    if (callback) callback(null);
  }

  end() {
    this.ended = true;
    this.connected = false; // Set connected to false on end
  }
}

// Mock MQTT module
const mockMqtt = {
  connect: sinon.stub().returns(new MockMqttClient())
};

// Use proxyquire to inject the mock MQTT module
const MqttRelay = proxyquire('../src/mqtt-relay', { 'mqtt': mockMqtt });

describe('MqttRelay', function () {
  let clientIn, clientOut;

  beforeEach(function () {
    mockMqtt.connect.resetHistory();
    clientIn = new MockMqttClient();
    clientOut = new MockMqttClient();
    mockMqtt.connect.onFirstCall().returns(clientIn);
    mockMqtt.connect.onSecondCall().returns(clientOut);
  });

  it('should be instantiable', function () {
    const relay = new MqttRelay({ name: 'test' });
    assert(relay instanceof MqttRelay);
  });

  it('should handle exact match topic mapping', async function () {
    const config = {
      name: 'test',
      brokerInUrl: 'mqtt://localhost',
      brokerOutUrl: 'mqtt://localhost',
      topicMap: [
        { in: 'test/topic', out: 'test/topic/out' },
      ],
    };
    const relay = new MqttRelay(config);
    const startPromise = relay.start();

    clientIn.emit('connect');
    clientOut.emit('connect');

    await startPromise;

    clientIn.emit('message', 'test/topic', Buffer.from('test message'), { qos: 0, retain: false });

    assert.strictEqual(clientOut.publishedMessages.length, 1);
    assert.strictEqual(clientOut.publishedMessages[0].topic, 'test/topic/out');
    assert.strictEqual(clientOut.publishedMessages[0].message, 'test message');
    relay.stop();
  });

  it('should handle prefix match with dynamic subtopics', async function () {
    const config = {
      name: 'test',
      brokerInUrl: 'mqtt://localhost',
      brokerOutUrl: 'mqtt://localhost',
      topicMap: [
        { in: 'device123/sensor/#', out: 'home/sensors' },
      ],
    };
    const relay = new MqttRelay(config);
    const startPromise = relay.start();

    clientIn.emit('connect');
    clientOut.emit('connect');

    await startPromise;

    clientIn.emit('message', 'device123/sensor/temperature/reading', Buffer.from('25C'), { qos: 0, retain: false });

    assert.strictEqual(clientOut.publishedMessages.length, 1);
    assert.strictEqual(clientOut.publishedMessages[0].topic, 'home/sensors/temperature/reading');
    assert.strictEqual(clientOut.publishedMessages[0].message, '25C');
    relay.stop();
  });

  it('should handle pass-through mapping when out is not specified', async function () {
    const config = {
      name: 'test',
      brokerInUrl: 'mqtt://localhost',
      brokerOutUrl: 'mqtt://localhost:1884',
      topicMap: [
        { in: 'alerts/#' },
      ],
    };
    const relay = new MqttRelay(config);
    const startPromise = relay.start();

    clientIn.emit('connect');
    clientOut.emit('connect');

    await startPromise;

    clientIn.emit('message', 'alerts/high', Buffer.from('fire alarm'), { qos: 0, retain: false });

    assert.strictEqual(clientOut.publishedMessages.length, 1);
    assert.strictEqual(clientOut.publishedMessages[0].topic, 'alerts/high');
    assert.strictEqual(clientOut.publishedMessages[0].message, 'fire alarm');
    relay.stop();
  });
});