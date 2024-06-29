# Fabric Plugin for Obsidian

## Overview

The Fabric Plugin for Obsidian integrates the Fabric tool into the Obsidian note-taking application. This plugin allows users to run Fabric commands directly from within Obsidian, leveraging Fabric's capabilities to process text and generate output notes.

## Features

- **Fabric Command Execution**: Run Fabric commands on the current note or clipboard content.
- **Pattern Search**: Search and select Fabric patterns using a dropdown interface.
- **Output Note Creation**: Generate and save output notes based on Fabric command results.
- **Settings Management**: Configure paths for Fabric and FFmpeg executables, and specify an output folder for generated notes.
- **Installation Checks**: Test the availability of Fabric and FFmpeg installations.

## Installation

1. Download and install the plugin in your Obsidian vault.
2. Configure the plugin settings to provide paths to the Fabric and FFmpeg executables.

## Configuration

### Settings

- **Fabric Path**: Path to the Fabric executable. If Fabric is not found, provide the full path.
- **FFmpeg Path**: Path to the FFmpeg executable. If FFmpeg is not found, provide the full path.
- **Output Folder**: Folder to save Fabric output notes.

### Setting Up

1. Open the settings tab for the Fabric Plugin.
2. Enter the paths for the Fabric and FFmpeg executables.
3. Specify the output folder where generated notes will be saved.

### Testing Installation

- Use the "Test Fabric Installation" button to check if Fabric is correctly installed.
- Use the "Test FFmpeg Installation" button to check if FFmpeg is correctly installed.

## Usage

### Activating the Plugin

1. Click on the ribbon icon (brain) labeled "fabric" to activate the Fabric view.
2. The Fabric view will open, displaying options to run Fabric commands on the current note or clipboard content.

### Running Fabric Commands

1. **Current Note**: Click the "Current Note" button to run a Fabric command on the content of the currently active note.
2. **Clipboard**: Click the "Clipboard" button to run a Fabric command on the content of the clipboard.

### Searching Patterns

1. Enter a search query in the "Search patterns..." input field.
2. The dropdown will display matching patterns based on your query.
3. Select a pattern from the dropdown to use it in a Fabric command.

### Generating Output Notes

1. Enter a name for the output note in the "Output note name" input field.
2. Run a Fabric command using one of the available options (Current Note, Clipboard, or selected pattern).
3. The plugin will create a new note with the specified name in the configured output folder.

## Development

### Code Structure

- **FabricPlugin**: Main class that handles plugin loading, settings management, and command execution.
- **FabricView**: Custom view for interacting with Fabric commands and displaying results.
- **FabricSettingTab**: Settings tab for configuring plugin options.

### Key Methods

- `onload()`: Initializes the plugin, loads settings, and registers views and icons.
- `loadSettings()`: Loads plugin settings from storage.
- `saveSettings()`: Saves plugin settings to storage.
- `checkFabricAvailability()`: Checks if Fabric is available by running a test command.
- `checkFFmpegAvailability()`: Checks if FFmpeg is available by running a test command.
- `runFabricCommand(args, input)`: Executes a Fabric command with specified arguments and input.
- `activateView()`: Activates and reveals the custom Fabric view.

### Custom View Components

- **Pattern Search Input**: Input field for searching Fabric patterns.
- **Pattern Dropdown**: Dropdown menu displaying matching patterns based on search query.
- **Output Note Input**: Input field for specifying the name of the output note.
- **Buttons Container**: Container for action buttons (Current Note, Clipboard).
- **Progress Spinner**: Spinner indicating progress during command execution.

## Help Text

The help text provides platform-specific instructions for locating the paths of Fabric and FFmpeg executables:

- **macOS/Linux**:
  - Open Terminal
  - Run `which fabric` or `which ffmpeg`
  - Copy the output path and paste it in settings
  - Default patterns folder: `~/.config/fabric/patterns`

- **Windows**:
  - Open Command Prompt
  - Run `where fabric` or `where ffmpeg`
  - Copy the output path and paste it in settings
  - Default patterns folder: `%APPDATA%\fabric\patterns`

## License

This project is licensed under the MIT License.

---

For more information, visit the [Fabric GitHub repository](https://github.com/danielmiessler/fabric).