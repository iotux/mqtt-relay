#!/usr/bin/env node

const args = process.argv;
const yaml = require('yamljs');
const mqtt = require("mqtt");

const configFile = process.argv.length > 2 ? process.argv[2] : './relay-config.yaml';
console.log('Using configuration from ' + configFile);
const config = yaml.load(configFile);

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

const topicIn = config.topicIn || '';
const topicOutPrefix = config.topicOutPrefix || '';

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
      relay.clientIn.subscribe(topicIn, function (err) {
        if (err) {
          console.log("clientIn error", err);
        } else {
          console.log(`Listening on \"${brokerInUrl}\" with topic \"${topicIn}\"`)
        }
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
      if (topicOutPrefix !== '')
         topic = topicOutPrefix + topic;
      relay.clientOut.publish(topic, message);
    });
  }
};

relay.init();
relay.run();
