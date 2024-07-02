# Fabric Plugin for Obsidian

## Overview

This plugin integrates the Fabric tool into Obsidian, allowing users to run Fabric commands directly from within the Obsidian interface. It also supports FFmpeg for additional functionalities and provides a user-friendly interface for managing settings and running commands.

## Features

- **Fabric Command Execution**: Run Fabric commands on the current note or clipboard content.
- **Pattern Search**: Search and select Fabric patterns.
- **YouTube Link Detection**: Automatically detect and process YouTube links.
- **Settings Management**: Configure paths for Fabric and FFmpeg executables.
- **Pattern Refresh**: Refresh available Fabric patterns from the API.
- **Output Note Creation**: Save Fabric command outputs as new notes in a specified folder.

## Installation

### Prerequisites

1. **Fabric**: Install Fabric from [danielmiessler/fabric](https://github.com/danielmiessler/fabric).
2. **Fabric Connector**: Install Fabric Connector from [chasebank87/fabric-connector](https://github.com/chasebank87/fabric-connector).

### Steps

1. Follow the installation instructions provided in the respective repositories for Fabric and Fabric Connector.
2. Ensure that both Fabric and FFmpeg are installed and accessible from your system's PATH.

## Settings

### Fabric Path

Path to the Fabric executable. If Fabric is not found, provide the full path.

### FFmpeg Path

Path to the FFmpeg executable. If FFmpeg is not found, provide the full path.

### Output Folder

Folder to save Fabric output notes.

### YouTube Autodetect

Toggle to enable or disable automatic detection of YouTube links in the content.

## Usage

### Running Fabric Commands

1. **Current Note**: Run a Fabric command on the content of the currently active note.
2. **Clipboard**: Run a Fabric command on the content copied to the clipboard.
3. **Pattern**: Select a pattern from the dropdown and run a Fabric command using that pattern.

### YouTube Link Detection

If YouTube autodetect is enabled, the plugin will scan for YouTube links in the content and prompt you to select a link to process.

### Refresh Patterns

Click the refresh button to reload available patterns from the API.

## Testing Installations

### Test Fabric Installation

1. Go to the plugin settings.
2. Click the "Test" button under "Test Fabric Installation".
3. A notice will indicate whether Fabric is correctly installed and how many patterns are available.

### Test FFmpeg Installation

1. Go to the plugin settings.
2. Click the "Test" button under "Test FFmpeg Installation".
3. A notice will indicate whether FFmpeg is correctly installed.

## Help Text

If Fabric or FFmpeg is installed for the user instead of globally, provide the full path to the binary.

### macOS

1. Open Terminal.
2. Run `which fabric` or `which ffmpeg`.
3. Copy the output path and paste it in the settings.

The default fabric patterns folder is `~/.config/fabric/patterns`.

### Linux

1. Open Terminal.
2. Run `which fabric` or `which ffmpeg`.
3. Copy the output path and paste it in the settings.

The default fabric patterns folder is `~/.config/fabric/patterns`.

### Windows

1. Open Command Prompt.
2. Run `where fabric` or `where ffmpeg`.
3. Copy the output path and paste it in the settings.

The default fabric patterns folder is `%APPDATA%\fabric\patterns`.

## Contributing

Contributions are welcome! Please fork the repository and submit a pull request with your changes.

## License

This project is licensed under the MIT License.

---

For more information, visit the [official documentation](https://github.com/danielmiessler/fabric) and [Fabric Connector repository](https://github.com/chasebank87/fabric-connector).