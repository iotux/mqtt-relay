

# mqtt-relay

**mqtt-relay** is a flexible MQTT relay module that forwards messages from one broker to another. It allows you to selectively map and transform topics, enabling you to set custom output topics while preserving subtopic structures. This functionality is particularly useful in complex setups where specific MQTT topics need to be routed or modified between brokers.

## Installation

Make a directory where you want your mqtt-relay reside, then cd to that directory.

```bash
mkdir mqtt-relay
cd mqtt-relay
```

Install the `mqtt-relay` package:

```bash
npm install mqtt-relay
```

Start the install script

```bash
bash node_modules/mqtt-relay/install.sh
```
The `install.sh` script will copy a fully functional example program `relay.js` and an example configuration file `relay-config-sample.yaml` to your chosen directory.

```bash
cp relay-config-sample.yaml relay-config.yaml
```

## Usage

### Basic Setup

After installation, edit your newly created configuration file to specify the MQTT brokers, relay options, and topic mappings.

You can run multiple instances with different configurations. For each instance, specify the config file as a parameter:

```bash
node mqtt-relay.js another-config.yaml
```

With the provided program, you can also configure several setups in a single cofiguration as shown in the sample configuration file, giving each instance a name.
The name is shown in the logs.

### Using PM2

To manage instances of `mqtt-relay` that need to run unattended, you can use [PM2](https://www.npmjs.com/package/pm2). Set each instance with a unique name:

```bash
pm2 --name "mqtt-relay-instance" start mqtt-relay.js -- relay-config.yaml
```

## Configuration

### Config Structure

The configuration file allows you to define both input and output brokers, publishing options, and detailed topic mappings for flexible topic transformations.

### Example Configuration

```yaml
name: mqtt-relay-example
brokerInUrl: "mqtt://input-broker.example.com:1883"
brokerInOptions:
  username: "inputUser"
  password: "inputPassword"

brokerOutUrl: "mqtt://output-broker.example.com:1883"
brokerOutOptions:
  username: "outputUser"
  password: "outputPassword"

publishOptions:
  retain: true
  qos: 1

debug: false

topicMap:
  - in: "device123/sensor/#"
    out: "home/sensors"
  - in: "monitoring/temperature"
    out: "metrics/temperature"
  - in: "alerts/#"
    out: "notifications/alerts"
  - in: "system/status"
    out: "status/system"
```

### `topicMap` Configuration

`topicMap` specifies how each input topic (`in`) is transformed before it is published to the output broker. This allows you to relay topics directly or modify them based on custom mappings.

#### Types of Mappings

1. **Prefix Match with Dynamic Subtopics**:
   - If the `in` topic ends with `/#`, it will match the topic prefix and relay any additional subtopic structure.
   - Example:
     ```yaml
     - in: "device123/sensor/#"
       out: "home/sensors"
     ```
     - Incoming topic: `device123/sensor/temperature/reading`
     - Published topic: `home/sensors/temperature/reading`

2. **Exact Match**:
   - If the `in` topic does not end with `/#`, it will only match the specific topic exactly as written.
   - Example:
     ```yaml
     - in: "monitoring/temperature"
       out: "metrics/temperature"
     ```
     - Incoming topic: `monitoring/temperature`
     - Published topic: `metrics/temperature`

3. **Pass-Through (No `out` Specified)**:
   - If no `out` field is provided, the input topic will be passed through unmodified.
   - Example:
     ```yaml
     - in: "alerts/#"
     ```
     - Incoming topic: `alerts/high`
     - Published topic: `alerts/high`

### Constructing `topicMap`

To construct the `topicMap`:

- **`in`**: Specify the incoming topic to match. Use `+` to match one level and `/#` at the end to match all remaining subtopics.
- **`out`** (optional): Specify the output topic prefix. If `/#` is used in `in`, the remaining subtopics will be appended to `out`.

Examples:

1. **Dynamic Mapping with Prefix**:
   ```yaml
   - in: "device123/sensor/#"
     out: "home/sensors"
   ```
   - Matches all topics under `device123/sensor` and publishes them under `home/sensors` with the original subtopics appended.

2. **Exact Mapping**:
   ```yaml
   - in: "monitoring/temperature"
     out: "metrics/temperature"
   ```
   - Only `monitoring/temperature` is matched and relayed as `metrics/temperature` with no appended subtopics.

3. **Pass-Through**:
   ```yaml
   - in: "alerts/#"
   ```
   - Passes through all topics under `alerts` without modification.

### Additional Options

- **`brokerInUrl`**: URL of the input broker.
- **`brokerInOptions`**: Credentials for the input broker.
- **`brokerOutUrl`**: URL of the output broker.
- **`brokerOutOptions`**: Credentials for the output broker.
- **`publishOptions`**:
  - `retain`: Whether to retain messages on the output broker.
  - `qos`: QoS level for the output broker (0, 1, or 2).
- **`debug`**: Set to `true` to enable detailed logging.

## You can also write your own program by importing the mqtt-relay module:
```javascript
const MqttRelay = require('mqtt-relay');

// Example configuration
const config = {
  name: "relay1",
  brokerInUrl: "mqtt://input-broker.example.com:1883",
  brokerOutUrl: "mqtt://output-broker.example.com:1883",
  topicMap: [
    { in: "device/sensor/#", out: "home/sensors" },
    { in: "alerts/#", out: "notifications/alerts" },
  ],
  publishOptions: { retain: true, qos: 1 },
  debug: true,
};

const relay = new MqttRelay(config);
relay.init();
relay.run();
```

## License

This project is licensed under the MIT License. See the [LICENSE](./LICENSE) file for details.
```
