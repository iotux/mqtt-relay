#!/usr/bin/env node

const fs = require('fs');
const yaml = require('js-yaml');
const MqttRelay = require('mqtt-relay');

function log(message, debug) {
  if (debug) {
    console.log(message);
  }
}

const configFile = process.argv.length > 2 ? process.argv[2] : './relay-config.yaml';

console.log('Using configuration from ' + configFile);

let relayInstances = {}; // Store active relay instances by name

function loadYaml(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, "utf8");
    const data = yaml.load(fileContents);
    return data;
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${error}`);
  }
}

// Initial load and start
// Load configuration and initialize relay instances
function loadConfigAndInitializeRelays() {
  let pairs = loadYaml(configFile);

  // If the config is a single object, wrap it in an array
  if (!Array.isArray(pairs)) {
    pairs = [pairs];
  }

  const newRelays = {};

  pairs.forEach((pairConfig, index) => {
    // Use the provided name or generate a default name based on the index
    const name = pairConfig.name || `relay${index}`;

    if (!relayInstances[name]) {
      const relayInstance = new MqttRelay(pairConfig);
      relayInstance.init();
      relayInstance.run();
      newRelays[name] = relayInstance;
    } else {
      // Update topics for existing instances
      relayInstances[name].topicIn = new Set(pairConfig.topicIn || []);
      relayInstances[name].debug = pairConfig.debug || false; // Update debug flag
      relayInstances[name].updateSubscriptions();
      newRelays[name] = relayInstances[name];
    }
  });

  // Stop and remove pairs that are no longer in the config
  for (const name in relayInstances) {
    if (!newRelays[name]) {
      relayInstances[name].stop();
      delete relayInstances[name];
    }
  }

  relayInstances = newRelays;
}


// Initial load and start
loadConfigAndInitializeRelays();

// Listen for SIGHUP to reload configuration and update pairs
process.on('SIGHUP', () => {
  console.log('Received SIGHUP signal, reloading configuration...');
  loadConfigAndInitializeRelays();
});