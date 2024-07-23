# Fabric Plugin for Obsidian

If you like this plugin, feel free to support the development by buying a coffee:
<div>
<img src="bmc_qr.png" height=80px>
<a href="https://www.buymeacoffee.com/chasebank87" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-violet.png" alt="Buy Me A Coffee" style="height: 80px !important;width: 250px !important;" ></a>
</div>

## Overview

The Fabric Plugin is an advanced integration tool for Obsidian, designed to enhance content creation and management within the Obsidian ecosystem. It connects to external APIs to fetch and manipulate data based on user-defined patterns and models. The plugin also supports custom pattern management and YouTube link detection.

## Features

- **Custom Pattern Management**: Watch for changes in a designated folder and sync patterns.
- **Community Custom Patterns**: Download and share custom patterns with other fabric users. 
  - [Fork repo to submit your patterns](https://github.com/chasebank87/fabric-patterns)
- **YouTube Link Detection**: Automatically detect YouTube links in notes.
- **External API Integration**: Connect to Fabric Connector API and Tavily API for enhanced content manipulation.
- **Dynamic Content Rendering**: Render content dynamically based on user interactions and API responses.
- **Debugging Support**: Toggle debug mode for additional logging.

## Prerequisites

1. **Fabric**: Install Fabric from [danielmiessler/fabric](https://github.com/danielmiessler/fabric).
2. **Fabric Connector**: Install Fabric Connector from [chasebank87/fabric-connector](https://github.com/chasebank87/fabric-connector).

## Installation

To install the Fabric Plugin, follow these steps:

1. Download the plugin from the official repository.
2. Place the plugin in your Obsidian's plugins folder.
3. Enable the plugin from Obsidian's settings under "Community Plugins".

## Configuration

Configure the plugin by setting up the necessary API URLs and keys through the plugin settings tab in Obsidian.

### Settings

- `Fabric Connector API URL`: URL to the Fabric Connector API.
- `Fabric Connector API Key`: Authentication key for the Fabric Connector API.
- `Output Folder`: Default folder path where output files will be saved.
- `Custom Patterns Folder`: Folder path for storing and managing custom patterns.
- `YouTube Autodetect Enabled`: Toggle to enable or disable automatic YouTube link detection.
- `Default Model`: Default model used for data processing.
- `Debug`: Enable or disable debug mode for logging.

### Usage

1. **Pattern Management**: Add or remove markdown files in the custom patterns folder to manage patterns.
2. **YouTube Transcription**: Autodetect youtube links in current note or clipboard and transcribe them using whisper and then running a pattern against.
3. **Tavily Search**: Use the Tavily API to search for relevant content, and process through results through the selected pattern.
4. **Input Sources**: 
	1. ***Current Note***: Uses the current active note as the source to be sent to fabric.
	2. ***Clipboard***: Uses the clipboard as the source to be sent to fabric.
	3. ***Tavily***: Uses Tavily Search results as the source to be sent to fabric.
5. **Pattern Selection**: Choose a pattern from the available custom or built in patterns to process the input data.
6. **Models**: Select a model from the available options to process the input data and pattern.
7. **Upload Patterns**: One way sync to fabric, will create if the custom pattern does not exist, and update if it does
8. **Update Patterns and Models**: Refreshes the models and patterns displayed in the dropdowns.

### Demonstration

![currentNote](https://github.com/chasebank87/unofficial-fabric-plugin/blob/main/currentNote-demo.gif)
### Debugging

Toggle the debug mode in settings to view detailed logs in the console. This can help in tracing issues and understanding the flow of data.

Contributions are welcome. Please fork the repository, make changes, and submit a pull request for review.

## License

This project is licensed under the MIT License - see the LICENSE file for details.

---

For more information on usage and configuration, refer to the detailed comments within the codebase or visit the [Fabric Plugin Documentation](#).


# my_fabric_patterns
