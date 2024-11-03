const mqtt = require("mqtt");

class MqttRelay {
  constructor(pairConfig, options = {}) {
    this.name = pairConfig.name;
    this.debug = pairConfig.debug || false;
    this.brokerInUrl = pairConfig.brokerInUrl || 'mqtt://localhost:1883';
    this.brokerInOptions = pairConfig.brokerInOptions || {};
    this.topicIn = new Set(pairConfig.topicIn || []);
    this.brokerOutUrl = pairConfig.brokerOutUrl || 'mqtt://localhost:1883';
    this.brokerOutOptions = pairConfig.brokerOutOptions || {};
    this.publishOptions = pairConfig.publishOptions || { retain: false, qos: 1 };
    this.topicOutPrefix = pairConfig.topicOutPrefix || '';

    // Use user-provided log function or default to console logging based on debug flag
    this.log = options.log || ((message) => {
      if (this.debug) {
        console.log(message);
      }
    });

    this.clientIn = null;
    this.clientOut = null;
    this.activeSubscriptions = new Set();
  }

  init() {
    if (this.topicIn.size === 0) {
      this.log(`Check configuration for pair "${this.name}", missing input topics.`);
      return;
    }

    this.log(`Connecting ${this.name}: ${this.brokerInUrl} -> ${this.brokerOutUrl}`);
    this.clientIn = mqtt.connect(this.brokerInUrl, this.brokerInOptions);
    this.clientOut = mqtt.connect(this.brokerOutUrl, this.brokerOutOptions);

    this.clientIn.on("connect", () => this.updateSubscriptions());
    this.clientOut.on("connect", () => this.log(`Pair "${this.name}": Publishing to ${this.brokerOutUrl} with prefix "${this.topicOutPrefix}"`));

    this.clientOut.on("error", (err) => console.error(`Pair "${this.name}" clientOut error: `, err));
  }

  updateSubscriptions() {
    // Unsubscribe from topics no longer in topicIn and send null message to clear retain if needed
    for (const topic of this.activeSubscriptions) {
      if (!this.topicIn.has(topic)) {
        this.clientIn.unsubscribe(topic, (err) => {
          if (err) {
            console.error(`Error unsubscribing from topic "${topic}" for pair "${this.name}":`, err);
          } else {
            this.log(`Pair "${this.name}": Unsubscribed from topic "${topic}"`);
            // Publish a null message to clear retained message if retain is false
            if (!this.publishOptions.retain) {
              this.clientOut.publish(`${this.topicOutPrefix}${topic}`, null, { retain: false });
            }
          }
        });
        this.activeSubscriptions.delete(topic);
      }
    }

    // Subscribe to new topics
    for (const topic of this.topicIn) {
      if (!this.activeSubscriptions.has(topic)) {
        this.clientIn.subscribe(topic, (err) => {
          if (err) {
            console.error(`clientIn subscribe error for pair "${this.name}":`, err);
          } else {
            this.log(`Pair "${this.name}": Subscribed to topic "${topic}"`);
            this.activeSubscriptions.add(topic);
          }
        });
      }
    }
  }


  run() {
    this.clientIn.on("message", (topic, message) => {
      const outputTopic = this.topicOutPrefix ? `${this.topicOutPrefix}${topic}` : topic;
      this.clientOut.publish(outputTopic, message, this.publishOptions);
      if (this.debug) this.log(`Pair "${this.name}" - Topic: ${outputTopic}`);
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

