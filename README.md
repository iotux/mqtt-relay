# mqtt-relay
A simple MQTT relay, receiving messages from one broker, publishing to another and optionally changing topics during the relaying process.

This program is meant to be a helping hand if you don't want to bother your broker during development work or otherwise.

The configuration is simple. Just copy the **relay-config.sample.yaml** to **relay-config.yaml**, then fill in the blanks.
It is possible to run several instances in parallel. Just make another copy of your configuration file and adjust the parameters.
Then run the program with the config file name as a single parameter like this:

  **./mqtt-relay.js whatever-config.yaml**

If running several instances is one of your work habits, then some kind of managing system should be in place.

**PM2 (https://www.npmjs.com/package/pm2)** is your friend for programs supposed to run unattended.

When using **PM2**, you can give each instance a unique name.
Just run the program like this:

  **pm2 --name remote-mqtt start mqtt-relay.js**

or, if you want to use a different named config file:

  **pm2 --name remote-mqtt start mqtt-relay.js -- whatever-config.yaml**

  ## A configuration example

```yaml
---
#
# mqtt-relay configuration
#
# Pay attention to the comments below and
# make changes appropriate for your requirements
# 
# Params for the source broker
# This example is for an insecure broker running locally
# Please surround parameters with "#" or ":" with quotes,
# as those characters are a part of the YAML syntax
brokerInUrl: "mqtt://localhost:1883"
brokerInUser:
brokerInPassword:
# topicIn is mandatory. It can be with or without MQTT wildcards
# It needs to be surrounded by quotes if the "#" wildcard is included
# An array of topics will be subscribed in sequence
topicIn: 
  - "whatever/#"
  - "what/else/do/you/have/in/mind#"

# Params for the destfination broker
# This example is for a remote broker secured with SSL/TLS and authentication
brokerOutUrl: "mqtts://broker.example.com:8883"
brokerOutUser: your_username
brokerOutPassword: your_very_secret_password
# topicOutPrefix can be blank or whatever with or without a trailing "/". 
# This will be prepended to outgoing topic
topicOutPrefix: relay/
```
