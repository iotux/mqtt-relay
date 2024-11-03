const assert = require('assert');
const MqttRelay = require('../src/mqtt-relay');

describe('MqttRelay', function () {
  it('should create an instance with the given configuration', function () {
    const config = {
      name: 'TestRelay',
      brokerInUrl: 'mqtt://localhost:1883',
      brokerOutUrl: 'mqtt://localhost:1884',
      topicIn: ['test/topic'],
      debug: true,
    };
    const relay = new MqttRelay(config);
    assert.strictEqual(relay.name, 'TestRelay');
    assert.strictEqual(relay.brokerInUrl, 'mqtt://localhost:1883');
    assert.strictEqual(relay.brokerOutUrl, 'mqtt://localhost:1884');
    assert.strictEqual(relay.debug, true);
  });

  it('should use a custom log function if provided', function () {
    let logCalled = false;
    const customLog = () => { logCalled = true; };
    const config = { name: 'TestRelay', topicIn: ['test/topic'] };
    const relay = new MqttRelay(config, { log: customLog });
    relay.log('Testing log');
    assert.strictEqual(logCalled, true);
  });
});

