#!/usr/bin/env node

const args = process.argv;
const fs = require('fs');
const yaml = require('js-yaml');
const mqtt = require("mqtt");

const configFile = process.argv.length > 2 ? process.argv[2] : './relay-config.yaml';
console.log('Using configuration from ' + configFile);
const config = loadYaml(configFile);

let topicIn = [];

// brokerIn options
const brokerInUrl = config.brokerInUrl || 'mqtt://localhost:1883';
const brokerInOptions = {
  username: config.brokerInUser || '',
  password: config.brokerInPassword || '',
}

// brokerOut options
const brokerOutUrl = config.brokerOutUrl || 'mqtt://localhost:1883';
const brokerOutOptions = {
  username: config.brokerOutUser || '',
  password: config.brokerOutPassword || '',
}

topicIn.push(config.topicIn) // || '';

const topicOutPrefix = config.topicOutPrefix || '';

function loadYaml(configPath) {
  try {
    const fileContents = fs.readFileSync(configPath, "utf8");
    const data = yaml.load(fileContents);
    return data;
  } catch (error) {
    console.error(`Error reading or parsing the YAML file: ${error}`);
  }
}

let relay = {
  clientIn: undefined,
  clientOut: undefined,

  init: function () {
    if (topicIn === '') {
      console.log('Check your configuration file,\nnot setting an input topic is a terrible idea, leaving..');
      process.exit(1);
    }

    console.log('Connecting...');
    relay.clientIn = mqtt.connect(brokerInUrl, brokerInOptions);
    relay.clientIn.on("connect", function () {
      topicIn.forEach((topic) => {
        relay.clientIn.subscribe(topic, function (err) {
          if (err) {
            console.log("clientIn error", err);
          } else {
            console.log(`Listening on \"${brokerInUrl}\" with topic \"${topic}\"`)
          }
        });
      });
    });

    relay.clientOut = mqtt.connect(brokerOutUrl, brokerOutOptions);
    this.clientOut.on("error", function (err) {
      if (err.errno === 'ENOTFOUND') {
        console.log('\nNot connectd to broker');
        console.log('Check your "config.yaml" file\n');
        process.exit(0);
      } else { console.log('clientOut error: ', err); }
    });

    relay.clientOut.on("connect", function () {
      if (topicOutPrefix === '')
        console.log(`Publishing to \"${brokerOutUrl}\"`);
      else
        console.log(`Publishing to \"${brokerOutUrl}\" with topicOutPrefix \"${topicOutPrefix}\"`);
    });
  },

  run: function () {
    relay.clientIn.on("message", function (topic, message) {
      //console.log(topic, JSON.parse(message.toString()));
      if (topicOutPrefix !== '')
         topic = topicOutPrefix + topic;
      relay.clientOut.publish(topic, message);
    });
  }
};

relay.init();
relay.run();

