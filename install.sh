#!/bin/bash

# Define target filenames
TARGET_PROGRAM="./relay.js"
TARGET_CONFIG="./relay-config.yaml"

# Check if files already exist
if [ -f "$TARGET_PROGRAM" ] || [ -f "$TARGET_CONFIG" ]; then
  echo "One or both target files already exist. Installation aborted to avoid overwriting."
  echo "Please remove the existing files or rename them, then re-run the script."
  exit 1
fi

# Copy example files
echo "Installing mqtt-relay example program and configuration..."
cp node_modules/mqtt-relay/examples/relay.js "$TARGET_PROGRAM"
cp node_modules/mqtt-relay/examples/relay-config-sample.yaml "$TARGET_CONFIG"

# Display success message
echo "Installation complete!"
echo ""
echo "Next steps:"
echo "1. Edit '$TARGET_CONFIG' to configure your MQTT brokers and topics."
echo "2. Run the program with:"
echo "   node $TARGET_PROGRAM"
echo ""
echo "For long-running instances, consider using pm2:"
echo "   pm2 --name mqtt-relay start $TARGET_PROGRAM"

