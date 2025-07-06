// MqttRelay.js
const mqtt = require('mqtt');

// Define log levels (numerical for easy comparison)
const LOG_LEVELS = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
  none: 4,
};
const DEFAULT_LOG_LEVEL_STRING = 'warn';
const DEFAULT_SHOW_TIMESTAMP = true;

/**
 * Safely gets a value from a nested object or array using a path string.
 * Path segments are separated by '/'. Array indices are numerical.
 */
function getValueByPath(obj, pathString) {
  if (!pathString || pathString.trim() === '' || pathString === '/' || pathString === 'root') {
    return obj;
  }
  const parts = pathString.replace(/^\/+|\/+$/g, '').split('/');
  let current = obj;
  for (const part of parts) {
    if (current === null || typeof current === 'undefined') return undefined;
    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index < 0 || index >= current.length) return undefined;
      current = current[index];
    } else if (typeof current === 'object') {
      if (Object.prototype.hasOwnProperty.call(current, part)) current = current[part];
      else return undefined;
    } else {
      return undefined;
    }
  }
  return current;
}

/**
 * Safely sets a value in a nested object or array using a path string.
 * Creates intermediate objects if they don't exist.
 */
function setValueByPath(obj, pathString, newValue) {
  if (!obj || typeof obj !== 'object' || !pathString || typeof pathString !== 'string') {
    return false;
  }
  const parts = pathString.replace(/^\/+|\/+$/g, '').split('/');
  let current = obj;

  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    const nextPartIsArrayIndex = !isNaN(parseInt(parts[i + 1], 10));

    if (Array.isArray(current)) {
      const index = parseInt(part, 10);
      if (isNaN(index) || index < 0) return false;
      if (index >= current.length) {
        current[index] = nextPartIsArrayIndex ? [] : {};
      } else if (typeof current[index] !== 'object' || current[index] === null) {
        current[index] = nextPartIsArrayIndex ? [] : {};
      }
      current = current[index];
    } else if (typeof current === 'object') {
      if (!Object.prototype.hasOwnProperty.call(current, part) || typeof current[part] !== 'object' || current[part] === null) {
        current[part] = nextPartIsArrayIndex ? [] : {};
      }
      current = current[part];
    } else {
      return false;
    }
  }

  const lastPart = parts[parts.length - 1];
  if (Array.isArray(current)) {
    const index = parseInt(lastPart, 10);
    if (isNaN(index) || index < 0) return false;
    current[index] = newValue;
  } else if (typeof current === 'object' && current !== null) {
    current[lastPart] = newValue;
  } else {
    return false;
  }
  return true;
}

class MqttRelay {
  constructor(pairConfig, options = {}) {
    if (!pairConfig) {
      throw new Error('pairConfig is required');
    }
    this.name = pairConfig.name || 'UnnamedRelay';
    this.isRunning = false;
    this.originalPairConfig = JSON.parse(JSON.stringify(pairConfig));
    this.options = options;

    this._initializeLogging(this.originalPairConfig, this.options);

    this.log(`Instance created. Refer to debug logs for detailed initial config.`, 'info');

    this.clientIn = null;
    this.clientOut = null;
    this.activeSubscriptions = new Set();
    this.topicMap = [];
    this.topicMappingsRaw = [];
    this.defaultPublishOptions = {};
    this.brokerInUrl = '';
    this.brokerInOptions = {};
    this.brokerOutUrl = '';
    this.brokerOutOptions = {};

    this.apiBaseTopic = '';
    this.instanceApiTopicPrefix = '';
    this.instanceApiSubscription = '';
    this.statusTopicBase = '';

    this._initializeFromConfig(this.originalPairConfig);
  }

  _getFormattedLocalISOTimestamp() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    const localISOTime = new Date(now.valueOf() - offset).toISOString().slice(0, 19);
    return localISOTime.replace('T', ' ');
  }

  _initializeLogging(pairConfig, constructorOptions = {}) {
    const logOptions = pairConfig.logOptions || {};
    const constructorOptionsLogging = constructorOptions.logging || {};
    let finalLogLevelString = logOptions.logLevel || constructorOptionsLogging.level || DEFAULT_LOG_LEVEL_STRING;
    const pairConfigDebugFlag = pairConfig.debug === true;
    if (pairConfigDebugFlag && !logOptions.logLevel) {
      finalLogLevelString = 'debug';
    }
    this.logLevelString = finalLogLevelString.toLowerCase();
    this.logLevel = LOG_LEVELS[this.logLevelString];
    if (this.logLevel === undefined) {
      console.warn(`[${this.name}] Bootstrap: Invalid log level "${this.logLevelString}". Defaulting to "${DEFAULT_LOG_LEVEL_STRING}".`);
      this.logLevelString = DEFAULT_LOG_LEVEL_STRING;
      this.logLevel = LOG_LEVELS[this.logLevelString];
    }
    this.useTimestamp = logOptions.useTimestamp !== undefined ? logOptions.useTimestamp : constructorOptionsLogging.useTimestamp !== undefined ? constructorOptionsLogging.useTimestamp : DEFAULT_SHOW_TIMESTAMP;
    this.useBrackets = logOptions.useBrackets !== undefined ? logOptions.useBrackets : constructorOptionsLogging.useBrackets !== undefined ? constructorOptionsLogging.useBrackets : true;
    this.logMqttMessages = logOptions.logMqttMessages === true || (pairConfigDebugFlag && logOptions.logMqttMessages !== false);
    this.supressMqttRelayInfo = logOptions.supressMqtt === true;

    if (!this.log) {
      this.log = (message, level = 'info') => {
        const messageLevelString = level.toLowerCase();
        const messageLevel = LOG_LEVELS[messageLevelString];
        if (messageLevel === undefined || messageLevel < this.logLevel) return;
        let logPrefixElements = [];
        if (this.useTimestamp) logPrefixElements.push(this.useBrackets ? `[${this._getFormattedLocalISOTimestamp()}]` : this._getFormattedLocalISOTimestamp());
        logPrefixElements.push(this.useBrackets ? `[${this.name}]` : this.name);
        logPrefixElements.push(this.useBrackets ? `[${level.toUpperCase()}]` : `${level.toUpperCase()}:`);
        const logPrefix = logPrefixElements.join(' ');
        const outputFn = console[messageLevelString === 'error' ? 'error' : messageLevelString === 'warn' ? 'warn' : 'log'];
        if (typeof message === 'object') outputFn(logPrefix, message);
        else outputFn(`${logPrefix} ${message}`);
      };
    }
  }

  _initializeFromConfig(config) {
    this.log(`Re-initializing internal state from configuration.`, 'debug');
    this._initializeLogging(config, this.options);

    this.brokerInUrl = config.brokerInUrl || 'mqtt://localhost:1883';
    this.brokerInOptions = config.brokerInOptions || {};
    this.brokerOutUrl = config.brokerOutUrl || 'mqtt://localhost:1883';
    this.brokerOutOptions = config.brokerOutOptions || {};
    this.defaultPublishOptions = { retain: false, qos: 0, ...(config.publishOptions || {}) };

    this.apiBaseTopic = config.apiBaseTopic || `mqtt-relay`;
    this.instanceApiTopicPrefix = `${this.apiBaseTopic}/${this.name}/`;
    this.instanceApiSubscription = `${this.instanceApiTopicPrefix}#`;
    this.statusTopicBase = `${this.apiBaseTopic}/status/${this.name}`;

    let topicMappingsInput = config.topicMap;
    if (!topicMappingsInput || !Array.isArray(topicMappingsInput) || topicMappingsInput.length === 0) {
      this.log("No topicMap provided. Defaulting to 'forward all' mode ('#' -> same topic).", 'info');
      topicMappingsInput = [{ in: '#' }];
    }
    this.topicMappingsRaw = JSON.parse(JSON.stringify(topicMappingsInput));

    this.topicMap = topicMappingsInput
      .map((mapping) => {
        if (!mapping || typeof mapping.in !== 'string') {
          this.log(`Invalid topic mapping: ${JSON.stringify(mapping)}. Skipping.`, 'warn');
          return null;
        }
        const sub = mapping.in;
        const outCfg = mapping.out;
        const fwdAsIs = typeof outCfg !== 'string' || outCfg.trim() === '';
        if (fwdAsIs) this.log(`Mapping "in: ${sub}" forwards to incoming topic.`, 'debug');
        let patStr;
        if (sub === '#') patStr = '^(.*)$';
        else if (sub.endsWith('/#')) {
          const b = sub.substring(0, sub.length - 2);
          const eB = b.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\+/g, '([^/]+)');
          patStr = '^' + eB + '\\/(.*)$';
        } else patStr = '^' + sub.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\\\+/g, '([^/]+)') + '$';
        const pat = new RegExp(patStr);
        const pI = sub.indexOf('+'),
          hI = sub.indexOf('#');
        let wcPos = -1;
        if (pI !== -1) wcPos = pI;
        if (hI === sub.length - 1 && (wcPos === -1 || hI < wcPos)) wcPos = hI;
        const hasWc = wcPos !== -1;
        const inPrefRepl = hasWc ? sub.substring(0, wcPos) : sub;
        const q = mapping.qos === 'auto' || typeof mapping.qos === 'number' ? mapping.qos : this.defaultPublishOptions.qos;
        const r = mapping.retain === 'auto' || typeof mapping.retain === 'boolean' ? mapping.retain : this.defaultPublishOptions.retain;
        const pubOpts = { qos: q, retain: r };
        this.log(`Mapping: Sub='${sub}', OutCfg='${outCfg || ''}', Regex='${pat.source}', PubOpts=${JSON.stringify(pubOpts)}`, 'debug');
        return {
          subscriptionTopic: sub,
          outputPrefixConfig: outCfg,
          pattern: pat,
          hasWildcard: hasWc,
          inputTopicPrefixToReplace: inPrefRepl,
          publishOptions: pubOpts,
          forwardInTopicAsIs: fwdAsIs,
        };
      })
      .filter((m) => m !== null);

    if (this.topicMap.length === 0 && topicMappingsInput.length > 0 && !(topicMappingsInput.length === 1 && topicMappingsInput[0].in === '#')) this.log('All configured topic mappings invalid after re-init.', 'error');
    else if (this.topicMap.length === 0) this.log('No topic mappings configured after re-init.', 'warn');
    this.log(`Instance "${this.name}" internal state re-initialized. Control sub: ${this.instanceApiSubscription}`, 'info');
  }

  async start() {
    return new Promise(async (resolve, reject) => {
      this.log(`Connecting MQTT clients for "${this.name}"...`, 'info');
      this.isRunning = false;

      if (this.clientIn || this.clientOut) {
        this.log('Existing clients found during init. Attempting to stop them first.', 'warn');
        try {
          await this.stop();
        } catch (stopError) {
          this.log(`Error stopping existing clients during init: ${stopError.message}`, 'error');
          // Decide if this is fatal or if we can proceed to try to connect new clients
        }
      }

      const inOpts = { ...this.brokerInOptions, clientId: `relay_in_${this.name}_${Math.random().toString(16).substr(2, 8)}` };
      const outOpts = {
        ...this.brokerOutOptions,
        clientId: `relay_out_${this.name}_${Math.random().toString(16).substr(2, 8)}`,
      };

      this.clientIn = mqtt.connect(this.brokerInUrl, inOpts);
      this.clientOut = mqtt.connect(this.brokerOutUrl, outOpts);

      let inConnected = false;
      let outConnected = false;
      let connectionError = null;

      const checkAndResolve = () => {
        if (inConnected && (this.clientOut ? outConnected : true)) {
          // If clientOut is not essential for basic operation
          this.isRunning = true;
          this.publishStatus('Relay connected/initialized.');
          this.log(`Relay "${this.name}" is active and processing messages.`, 'info');
          resolve();
        } else if (connectionError) {
          this.isRunning = false;
          reject(connectionError);
        }
      };

      this.clientIn.on('connect', () => {
        this.log(`Connected to IN broker: ${this.brokerInUrl}`, 'info');
        inConnected = true;
        this.updateDataSubscriptions();
        this._subscribeToControlTopic();
        checkAndResolve();
      });
      this.clientIn.on('error', (err) => {
        this.log(`IN broker error: ${err.message}`, 'error');
        this.isRunning = false;
        connectionError = err;
        checkAndResolve(); // Attempt to resolve/reject if other client is already handled
      });
      this.clientIn.on('reconnect', () => this.log(`Reconnecting to IN broker`, 'warn'));
      this.clientIn.on('offline', () => {
        this.log(`IN broker offline`, 'warn');
        this.isRunning = false;
      });
      this.clientIn.on('close', () => {
        this.log(`IN broker connection closed`, 'info');
        this.isRunning = false;
      });

      this.clientOut.on('connect', () => {
        this.log(`Connected to OUT broker: ${this.brokerOutUrl}`, 'info');
        outConnected = true;
        checkAndResolve();
      });
      this.clientOut.on('error', (err) => {
        this.log(`OUT broker error: ${err.message}`, 'error');
        // For some relays, out broker might be optional or have different error handling
        // If clientOut is critical, set connectionError and checkAndResolve
        // connectionError = err;
        // checkAndResolve();
      });
      this.clientOut.on('reconnect', () => this.log(`Reconnecting to OUT broker`, 'warn'));
      this.clientOut.on('offline', () => this.log(`OUT broker offline`, 'warn'));
      this.clientOut.on('close', () => this.log(`OUT broker connection closed`, 'info'));

      this.clientIn.on('message', (topic, message, packet) => {
        if (topic.startsWith(this.instanceApiTopicPrefix)) {
          const commandAndPathString = topic.substring(this.instanceApiTopicPrefix.length);
          const parts = commandAndPathString.split('/');
          const commandActionWithPrefix = parts[0].toLowerCase();
          const configPath = parts.slice(1).join('/');
          this.log(`Dispatching to control: Action="${commandActionWithPrefix}", Path="${configPath}" from topic "${topic}"`, 'debug');
          this._handleControlMessage(commandActionWithPrefix, configPath, message.toString());
        } else if (this.isRunning) {
          this._handleDataMessage(topic, message, packet);
        } else {
          this.log(`Message on topic "${topic}" received while relay not running. Discarding.`, 'debug');
        }
      });
    });
  }

  _subscribeToControlTopic() {
    if (this.clientIn && this.clientIn.connected && this.instanceApiSubscription) {
      this.clientIn.subscribe(this.instanceApiSubscription, { qos: 0 }, (err) => {
        if (err) this.log(`Failed to subscribe to control topic pattern "${this.instanceApiSubscription}": ${err.message}`, 'error');
        else this.log(`Subscribed to API control topic pattern: "${this.instanceApiSubscription}"`, 'info');
      });
    } else this.log(`Cannot subscribe to control topic pattern, IN client not connected.`, 'warn');
  }

  _unsubscribeFromControlTopic() {
    return new Promise((resolve) => {
      if (this.clientIn && this.clientIn.connected && this.instanceApiSubscription) {
        this.clientIn.unsubscribe(this.instanceApiSubscription, (err) => {
          if (err) this.log(`Error unsubscribing from control topic pattern "${this.instanceApiSubscription}": ${err.message}`, 'error');
          else this.log(`Unsubscribed from API control topic pattern: "${this.instanceApiSubscription}"`, 'info');
          resolve();
        });
      } else {
        this.log('No control topic to unsubscribe from or client not connected.', 'debug');
        resolve();
      }
    });
  }

  updateDataSubscriptions() {
    if (!this.clientIn || !this.clientIn.connected) {
      this.log('Cannot update data subscriptions, IN client not connected.', 'warn');
      return;
    }
    if (this.topicMap.length === 0) {
      this.log('No data topic mappings to subscribe to.', 'debug');
      return;
    }
    const newTopics = new Set(this.topicMap.map((m) => m.subscriptionTopic));
    const toUnsub = new Set(),
      toSub = new Set();
    this.activeSubscriptions.forEach((s) => {
      if (!newTopics.has(s)) toUnsub.add(s);
    });
    newTopics.forEach((s) => {
      if (!this.activeSubscriptions.has(s)) toSub.add(s);
    });
    if (toUnsub.size > 0) {
      const arr = Array.from(toUnsub);
      this.clientIn.unsubscribe(arr, (e) => {
        if (e) this.log(`Error unsub data: ${arr.join()}`, 'error');
        else this.log(`Unsub data: ${arr.join()}`, 'info');
        arr.forEach((t) => this.activeSubscriptions.delete(t));
      });
    }
    if (toSub.size > 0) {
      const arr = Array.from(toSub);
      this.clientIn.subscribe(arr, (e, g) => {
        if (e) this.log(`Error sub data: ${arr.join()}`, 'error');
        else this.log(`Sub data: ${g.map((x) => `${x.topic}(Q${x.qos})`).join()}`, 'info');
        g.forEach((x) => this.activeSubscriptions.add(x.topic));
      });
    }
  }

  async _handleControlMessage(commandActionWithPrefix, configPath, payloadString) {
    this.log(`Processing control command: ActionPrefix="${commandActionWithPrefix}", Path="${configPath}", Payload="${payloadString}"`, 'debug');

    let valueForSetMod = null;
    try {
      valueForSetMod = JSON.parse(payloadString);
      this.log(`Control payload for set/mod parsed as JSON.`, 'debug');
    } catch (e) {
      valueForSetMod = payloadString;
      this.log(`Control payload for set/mod is a string: "${valueForSetMod}"`, 'debug');
    }

    if (['getstatus', 'stopinstance', 'startinstance'].includes(commandActionWithPrefix) && payloadString.trim() === '') {
      valueForSetMod = null;
    }

    switch (commandActionWithPrefix) {
      case 'getstatus':
        this.log('Processing getStatus command.', 'info');
        this.publishStatus('Status requested.');
        break;
      case 'config:get':
        this.log(`Processing config:get for path: "${configPath || '(root)'}"`, 'info');
        this._publishSpecificConfig(configPath);
        break;
      case 'config:set':
        this.log(`Processing config:set for path "${configPath}" with value:`, 'info', valueForSetMod);
        if (setValueByPath(this.originalPairConfig, configPath, valueForSetMod)) {
          this.log(`Successfully updated originalPairConfig @ "${configPath}". Re-initializing relay.`, 'info');
          await this.stop();
          this._initializeFromConfig(this.originalPairConfig);
          await this.init();
          this.publishStatus(`Configuration set for path: ${configPath}`); // This call should now be safe
        } else {
          this.log(`Failed to set value @ "${configPath}"`, 'error');
          this.publishStatus(`Error: Failed to set config for path: ${configPath}`);
        }
        break;
      case 'config:mod':
        this.log(`Processing config:mod for path "${configPath}" with value:`, 'info', valueForSetMod);
        const existingValue = getValueByPath(this.originalPairConfig, configPath);
        if (existingValue !== undefined && typeof existingValue === 'object' && existingValue !== null && typeof valueForSetMod === 'object' && valueForSetMod !== null && !Array.isArray(existingValue) && !Array.isArray(valueForSetMod)) {
          Object.assign(existingValue, valueForSetMod);
          this.log(`Successfully merged originalPairConfig @ "${configPath}". Re-initializing.`, 'info');
          await this.stop();
          this._initializeFromConfig(this.originalPairConfig);
          await this.init();
          this.publishStatus(`Configuration modified for path: ${configPath}`);
        } else if (existingValue !== undefined) {
          this.log(`Target for config:mod @ "${configPath}" not object or payload not object. Overwriting.`, 'warn');
          if (setValueByPath(this.originalPairConfig, configPath, valueForSetMod)) {
            this.log(`Successfully overwrote originalPairConfig @ "${configPath}". Re-initializing.`, 'info');
            await this.stop();
            this._initializeFromConfig(this.originalPairConfig);
            await this.init();
            this.publishStatus(`Configuration modified (overwritten) for path: ${configPath}`);
          } else {
            this.log(`Failed to mod (overwrite) @ "${configPath}".`, 'error');
            this.publishStatus(`Error: Failed to mod config for path: ${configPath}`);
          }
        } else {
          this.log(`Path "${configPath}" not found for config:mod.`, 'error');
          this.publishStatus(`Error: Path not found for config:mod - "${configPath}".`);
        }
        break;
      case 'setloglevel':
        let levelToSet = typeof valueForSetMod === 'string' ? valueForSetMod.trim() : valueForSetMod && typeof valueForSetMod.level === 'string' ? valueForSetMod.level.trim() : null;
        if (levelToSet) levelToSet = levelToSet.toLowerCase();
        if (levelToSet && LOG_LEVELS[levelToSet] !== undefined) {
          if (!this.originalPairConfig.logOptions) this.originalPairConfig.logOptions = {};
          this.originalPairConfig.logOptions.logLevel = levelToSet;
          this._initializeLogging(this.originalPairConfig, this.options);
          this.log(`Log level changed to "${levelToSet}" via API.`, 'info');
          this.publishStatus(`Log level updated to ${levelToSet}.`);
        } else {
          this.log(`Invalid level for setLogLevel: "${levelToSet || payloadString}". Valid: ${Object.keys(LOG_LEVELS).join(', ')}`, 'error');
          this.publishStatus(`Error: Invalid level for setLogLevel - "${levelToSet || payloadString}".`);
        }
        break;
      case 'stopinstance':
        this.log('Processing stopInstance command.', 'info');
        await this.stop();
        this.publishStatus('Relay instance stopped via API.');
        break;
      case 'startinstance':
        this.log('Processing startInstance command.', 'info');
        if (this.isRunning && this.clientIn && this.clientIn.connected) {
          this.log('Instance already running.', 'warn');
          this.publishStatus('Instance already running.');
        } else {
          // Ensure config is based on the latest originalPairConfig before starting
          this._initializeFromConfig(this.originalPairConfig);
          await this.init();
          if (this.clientIn && this.clientIn.connected) {
            this.log('Instance (re)started via API.', 'info');
          } else {
            this.log('Failed to (re)start instance via API.', 'error');
            this.publishStatus('Error: Failed to (re)start instance.');
          }
        }
        break;
      default:
        this.log(`Unknown control command: "${commandActionWithPrefix}" (Path: "${configPath}", Payload: "${payloadString}")`, 'warn');
        this.publishStatus(`Error: Unknown command - "${commandActionWithPrefix}".`);
    }
  }

  publishStatus(eventMessage = 'Status update.') {
    if (!this.clientIn || !this.clientIn.connected || !this.statusTopicBase) {
      this.log('Cannot publish status, IN client not connected or statusTopicBase not set.', 'warn');
      return;
    }
    const statusPayload = {
      name: this.name,
      timestamp: this._getFormattedLocalISOTimestamp(),
      event: eventMessage,
      isRunning: this.isRunning,
      logLevel: this.logLevelString,
      brokerIn: { url: this.brokerInUrl, connected: this.clientIn ? this.clientIn.connected : false },
      brokerOut: { url: this.brokerOutUrl, connected: this.clientOut ? this.clientOut.connected : false },
      activeDataSubscriptions: Array.from(this.activeSubscriptions),
      topicMapCount: this.topicMap.length,
    };
    try {
      const payloadString = JSON.stringify(statusPayload);
      const topic = `${this.statusTopicBase}/info`;
      this.clientIn.publish(topic, payloadString, { qos: 0, retain: false }, (err) => {
        if (err) this.log(`Failed to publish status to "${topic}": ${err.message}`, 'error');
        else this.log(`Status published to "${topic}" (Event: ${eventMessage})`, 'debug');
      });
    } catch (e) {
      this.log(`Error serializing status payload: ${e.message}`, 'error');
    }
  }

  _publishSpecificConfig(configPathString) {
    if (!this.clientIn || !this.clientIn.connected || !this.statusTopicBase) {
      this.log('Cannot publish specific config, IN client not connected or statusTopicBase not set.', 'warn');
      return;
    }
    const dataToPublish = getValueByPath(this.originalPairConfig, configPathString);
    const effectivePath = configPathString || '(root)';
    const responsePathSegment = configPathString ? configPathString.replace(/\//g, '_') : 'root';
    const responseTopic = `${this.statusTopicBase}/configValue/${responsePathSegment}`;
    let payloadString;
    if (dataToPublish === undefined) {
      this.log(`Config path "${effectivePath}" not found in original configuration.`, 'warn');
      payloadString = JSON.stringify({ error: 'Path not found', requestedPath: effectivePath });
    } else {
      try {
        payloadString = JSON.stringify(dataToPublish, null, 2);
      } catch (e) {
        this.log(`Error serializing config payload for path "${effectivePath}": ${e.message}`, 'error');
        payloadString = JSON.stringify({ error: 'Serialization error', requestedPath: effectivePath, details: e.message });
      }
    }
    this.clientIn.publish(responseTopic, payloadString, { qos: 0, retain: false }, (err) => {
      if (err) this.log(`Failed to publish config for path "${effectivePath}" to "${responseTopic}": ${err.message}`, 'error');
      else this.log(`Config for path "${effectivePath}" published to "${responseTopic}"`, 'info');
    });
  }

  _handleDataMessage(incomingTopic, message, packet) {
    let published = false;
    this.log(`Handling data message on: "${incomingTopic}" (Incoming QoS: ${packet.qos}, Retain: ${packet.retain})`, 'debug');
    if (this.logMqttMessages && !this.supressMqttRelayInfo) {
      this.log(`MQTT IN: ${incomingTopic} (QoS ${packet.qos}, Retain ${packet.retain}) Payload: ${message.toString()}`, 'info');
    }
    for (const mapping of this.topicMap) {
      this.log(`  Testing "${incomingTopic}" against pattern: ${mapping.pattern.source} (sub: "${mapping.subscriptionTopic}")`, 'debug');
      const match = incomingTopic.match(mapping.pattern);
      if (match) {
        this.log(`  Matched pattern for subscription "${mapping.subscriptionTopic}"`, 'debug');
        let currentMsgPublishOptions = { ...mapping.publishOptions };
        if (currentMsgPublishOptions.qos === 'auto') currentMsgPublishOptions.qos = packet.qos;
        if (currentMsgPublishOptions.retain === 'auto') currentMsgPublishOptions.retain = packet.retain;
        if (typeof currentMsgPublishOptions.qos !== 'number' || ![0, 1, 2].includes(currentMsgPublishOptions.qos)) {
          this.log(`Invalid QoS after 'auto' (${currentMsgPublishOptions.qos}), defaulting to instance default: ${this.defaultPublishOptions.qos}`, 'warn');
          currentMsgPublishOptions.qos = this.defaultPublishOptions.qos;
        }
        if (typeof currentMsgPublishOptions.retain !== 'boolean') {
          this.log(`Invalid Retain after 'auto' (${currentMsgPublishOptions.retain}), defaulting to instance default: ${this.defaultPublishOptions.retain}`, 'warn');
          currentMsgPublishOptions.retain = this.defaultPublishOptions.retain;
        }
        let outputTopic;
        if (mapping.forwardInTopicAsIs) {
          outputTopic = incomingTopic;
          this.log(`  Forwarding as is. Output topic: "${outputTopic}"`, 'debug');
        } else {
          let suffix = '';
          if (!mapping.hasWildcard) outputTopic = mapping.outputPrefixConfig;
          else {
            if (mapping.subscriptionTopic.endsWith('/#') && match[1] !== undefined) suffix = match[1];
            else if (mapping.subscriptionTopic.includes('+') && match[1] !== undefined) {
              if (incomingTopic.startsWith(mapping.inputTopicPrefixToReplace)) suffix = incomingTopic.substring(mapping.inputTopicPrefixToReplace.length);
              else if (mapping.inputTopicPrefixToReplace === '') suffix = incomingTopic;
              else {
                this.log(`Topic transform warning (wildcard+): incomingTopic "${incomingTopic}" mismatch with prefix "${mapping.inputTopicPrefixToReplace}". Suffix defaults to full incoming.`, 'warn');
                suffix = incomingTopic;
              }
            } else {
              if (incomingTopic.startsWith(mapping.inputTopicPrefixToReplace)) suffix = incomingTopic.substring(mapping.inputTopicPrefixToReplace.length);
              else if (mapping.inputTopicPrefixToReplace === '') suffix = incomingTopic;
            }
            const base = mapping.outputPrefixConfig;
            if (base === '') outputTopic = suffix.startsWith('/') && suffix.length > 1 ? suffix.substring(1) : suffix;
            else if (base.endsWith('/')) outputTopic = base + (suffix.startsWith('/') ? suffix.substring(1) : suffix);
            else outputTopic = base + (suffix.startsWith('/') || suffix === '' ? suffix : '/' + suffix);
          }
          if (outputTopic.length > 1 && outputTopic.endsWith('/')) outputTopic = outputTopic.substring(0, outputTopic.length - 1);
          outputTopic = outputTopic.replace(/\/\//g, '/');
          this.log(`  Transformed to output topic: "${outputTopic}" using outPrefix: "${mapping.outputPrefixConfig || ''}" and suffix: "${suffix}"`, 'debug');
        }
        if (this.brokerInUrl === this.brokerOutUrl && incomingTopic === outputTopic) {
          this.log(`Skipping relay for topic "${incomingTopic}" to prevent loop.`, 'warn');
        } else {
          if (this.clientOut && this.clientOut.connected) {
            const publishLogAction = () => {
              if (!this.supressMqttRelayInfo) {
                this.log(`Relayed: [${incomingTopic}] -> [${outputTopic}] (Outgoing QoS: ${currentMsgPublishOptions.qos}, Retain: ${currentMsgPublishOptions.retain})`, 'info');
              }
              if (this.logMqttMessages) {
                this.log(`${outputTopic} ${message.toString()}`, 'info');
              } else if (!this.supressMqttRelayInfo) {
                this.log(`  Message Preview (Outgoing): ${message.toString().substring(0, 100)}${message.length > 100 ? '...' : ''}`, 'debug');
              }
            };
            this.clientOut.publish(outputTopic, message, currentMsgPublishOptions, (err) => {
              if (err) {
                this.log(`Error publishing to OUT topic "${outputTopic}": ${err.message}`, 'error');
              } else {
                publishLogAction();
              }
            });
          } else {
            this.log(`Cannot publish to OUT topic "${outputTopic}", clientOut not connected.`, 'warn');
          }
        }
        published = true;
        break;
      }
    }
    if (!published) this.log(`Message from topic "${incomingTopic}" did not match patterns. Discarded.`, 'debug');
  }

  

  async stop() {
    this.log(`Stopping relay "${this.name}"...`, 'info');
    this.isRunning = false;

    const unsubs = [];
    if (this.clientIn && this.clientIn.connected) {
      if (this.instanceApiSubscription) {
        unsubs.push(
          new Promise((r) =>
            this.clientIn.unsubscribe(this.instanceApiSubscription, (e) => {
              if (e) this.log(`Error unsub control: ${e.message}`, 'error');
              else this.log('Unsub control topic.', 'info');
              r();
            }),
          ),
        );
      }
      if (this.activeSubscriptions.size > 0) {
        const dataTopics = Array.from(this.activeSubscriptions);
        unsubs.push(
          new Promise((r) =>
            this.clientIn.unsubscribe(dataTopics, (e) => {
              if (e) this.log(`Error unsub data topics: ${e.message}`, 'error');
              else this.log('Unsub data topics.', 'info');
              r();
            }),
          ),
        );
      }
    }
    try {
      await Promise.all(unsubs);
    } catch (e) {
      this.log(`Error during unsubscriptions: ${e.message}`, 'warn');
    }
    this.activeSubscriptions.clear();

    const clientEnds = [];
    if (this.clientIn) {
      const client = this.clientIn;
      this.clientIn = null;
      clientEnds.push(
        new Promise((resolve, reject) => {
          client.end(true, (err) => {
            if (err) this.log(`Error ending IN client: ${err.message}`, 'error');
            else this.log('IN client ended.', 'info');
            resolve();
          });
        }),
      );
    } else {
      this.log('IN client already null/not init.', 'info');
    }

    if (this.clientOut) {
      const client = this.clientOut;
      this.clientOut = null;
      clientEnds.push(
        new Promise((resolve, reject) => {
          client.end(true, (err) => {
            if (err) this.log(`Error ending OUT client: ${err.message}`, 'error');
            else this.log('OUT client ended.', 'info');
            resolve();
          });
        }),
      );
    } else {
      this.log('OUT client already null/not init.', 'info');
    }

    try {
      await Promise.all(clientEnds);
    } catch (e) {
      this.log(`Error during client end operations: ${e.message}`, 'warn');
    }
    this.log(`Relay "${this.name}" processing fully stopped.`, 'info');
  }
}

module.exports = MqttRelay;
