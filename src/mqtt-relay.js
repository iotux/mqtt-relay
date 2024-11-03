const mqtt = require("mqtt");

class MqttRelay {
  constructor(pairConfig, options = {}) {
    this.name = pairConfig.name;
    this.debug = pairConfig.debug || false;
    this.brokerInUrl = pairConfig.brokerInUrl || 'mqtt://localhost:1883';
    this.brokerInOptions = pairConfig.brokerInOptions || {};
    this.topicMappings = pairConfig.topicMap || [];
    this.brokerOutUrl = pairConfig.brokerOutUrl || 'mqtt://localhost:1883';
    this.brokerOutOptions = pairConfig.brokerOutOptions || {};
    this.publishOptions = pairConfig.publishOptions || { retain: false, qos: 1 };
    this.log = options.log || ((message) => { if (this.debug) console.log(message); });

    this.clientIn = null;
    this.clientOut = null;
    this.activeSubscriptions = new Set();

    // Prepare topic mappings with regular expressions for matching
    this.topicMap = this.topicMappings.map(mapping => {
      const inPattern = this.buildRegexFromTopic(mapping.in);
      return {
        inPattern,
        inTopic: mapping.in,
        outPrefix: mapping.out || null // Null outPrefix means "pass through"
      };
    });
  }

  // Helper function to convert MQTT topic with wildcards to a regex pattern
  buildRegexFromTopic(topic) {
    const pattern = topic
      .replace(/\+/g, '([^/]+)')   // + wildcard -> match one segment
      .replace(/\/#$/, '(\/.*)?$'); // # wildcard at end -> match rest of topic
    return new RegExp(`^${pattern}`);
  }

  init() {
    if (this.topicMap.length === 0) {
      this.log(`No topic mappings defined for pair "${this.name}".`);
      return;
    }

    this.log(`Connecting ${this.name}: ${this.brokerInUrl} -> ${this.brokerOutUrl}`);
    this.clientIn = mqtt.connect(this.brokerInUrl, this.brokerInOptions);
    this.clientOut = mqtt.connect(this.brokerOutUrl, this.brokerOutOptions);

    this.clientIn.on("connect", () => this.updateSubscriptions());
    this.clientOut.on("connect", () => this.log(`Pair "${this.name}": Connected to ${this.brokerOutUrl}`));

    this.clientOut.on("error", (err) => console.error(`Pair "${this.name}" clientOut error: `, err));
  }

  updateSubscriptions() {
    // Unsubscribe from topics no longer in topicMap
    for (const topic of this.activeSubscriptions) {
      if (!this.topicMap.some(mapping => mapping.inTopic === topic)) {
        this.clientIn.unsubscribe(topic, (err) => {
          if (!err) this.log(`Pair "${this.name}": Unsubscribed from topic "${topic}"`);
        });
        this.activeSubscriptions.delete(topic);
      }
    }

    // Subscribe to topics in topicMap
    for (const mapping of this.topicMap) {
      const topic = mapping.inTopic;
      if (!this.activeSubscriptions.has(topic)) {
        this.clientIn.subscribe(topic, (err) => {
          if (!err) this.log(`Pair "${this.name}": Subscribed to topic "${topic}"`);
          this.activeSubscriptions.add(topic);
        });
      }
    }
  }

  run() {
    this.clientIn.on("message", (topic, message) => {
      let outputTopic = topic; // Default to the original topic

      for (const mapping of this.topicMap) {
        const match = topic.match(mapping.inPattern);
        if (match) {
          if (mapping.outPrefix !== null) {
            // If outPrefix is specified, transform the topic
            outputTopic = `${mapping.outPrefix}${match[1] || ''}`;
          }
          break;
        }
      }

      // Publish to the output topic
      this.clientOut.publish(outputTopic, message, this.publishOptions);

      if (this.debug) {
        this.log(`Pair "${this.name}" - Received topic: ${topic} - Published as: ${outputTopic}`);
        this.log('Message:', message.toString());
      }
    });
  }

  stop() {
    for (const topic of this.activeSubscriptions) {
      this.clientIn.unsubscribe(topic, (err) => {
        if (!err) this.log(`Pair "${this.name}": Unsubscribed from topic "${topic}"`);
      });
    }
    if (this.clientIn) this.clientIn.end();
    if (this.clientOut) this.clientOut.end();
    this.log(`Pair "${this.name}" stopped.`);
  }
}

module.exports = MqttRelay;
