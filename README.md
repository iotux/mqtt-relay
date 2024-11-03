# mqtt-relay
A flexible MQTT relay module for receiving messages from one broker, publishing them to another, and optionally changing topics during the relaying process.

This package is designed to be a lightweight helper for managing MQTT message forwarding without overloading a broker, especially useful during development or for specific relay requirements.

## Installation
Install the mqtt-relay package:
```bash
npm install mqtt-relay
```

## Configuration

**1. Copy the sample configuration file:**

After installation, you can find a sample configuration file located at **node_modules/mqtt-relay/relay-config.sample.yaml**. Copy this to your project root as **relay-config.yaml:**
```bash
cp node_modules/mqtt-relay/relay-config.sample.yaml ./relay-config.yaml
```
**2. Edit the configuration file:**
Open **relay-config.yaml** and edit the configuration based on your broker settings and topics (see the configuration example below).

**3. Run the relay:**
You can run the program using the configuration file as a parameter:
```bash
node mqtt-relay.js relay-config.yaml
```

## Using with PM2
For programs intended to run unattended, PM2(https://www.npmjs.com/package/pm2) is a great process manager.
You can set up each instance with a unique name by running:
```bash
pm2 --name "remote-mqtt" start mqtt-relay.js -- relay-config.yaml
```
or for additional instances with other config files:
```bash
pm2 --name "another-mqtt-instance" start mqtt-relay.js -- another-config.yaml
```

## Using as a Module
You can use **MqttRelay** programmatically by importing it into your own Node.js scripts:
```jaascript
const MqttRelay = require('mqtt-relay');

// Example configuration
const config = {
  name: "RelayInstance",
  brokerInUrl: "mqtt://localhost:1883",
  brokerOutUrl: "mqtts://broker.example.com:8883",
  topicIn: ["some/topic/#"],
  topicOutPrefix: "relay/",
  debug: true
};

// Optional custom log function
const customLogFunction = (message) => {
  console.log(`[Custom Log] ${message}`);
};

// Create and run the relay
const relay = new MqttRelay(config, { log: customLogFunction });
relay.init();
relay.run();
```
## A configuration example
```yaml
---
# mqtt-relay configuration

# Params for the source broker
# Example of an insecure broker running locally
brokerInUrl: "mqtt://localhost:1883"
brokerInOptions:
  username: ""
  password: ""
# topicIn is mandatory; use MQTT wildcards if needed
# For example, "#" includes all subtopics
topicIn:
  - "whatever/#"
  - "what/else/do/you/have/in/mind#"

# Params for the destination broker
# Example for a remote broker secured with SSL/TLS and authentication
brokerOutUrl: "mqtts://broker.example.com:8883"
brokerOutOptions:
  username: "your_username"
  password: "your_very_secret_password"

# Optional topic prefix for outgoing messages
topicOutPrefix: "relay/"

# Set debug to true for logging relay activity
debug: false
```
## Features
- **Custom Logging:** You can provide your own log function for custom logging requirements.

- **Multiple Instances:** Run multiple instances with different configuration files.

- **PM2 Integration:** Easily manage instances with PM2 for unattended operation.

This module provides flexibility for a variety of MQTT relaying scenarios, whether used as a standalone script or integrated into your own application.

## License
This project is licensed under the MIT License.
