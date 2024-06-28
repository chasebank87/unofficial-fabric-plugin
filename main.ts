import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, Notice, ItemView, MarkdownRenderer } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fuzzaldrin from 'fuzzaldrin-plus';

const execAsync = promisify(exec);

interface FabricPluginSettings {
    fabricPath: string;
    ffmpegPath: string;
    outputFolder: string;
}

const DEFAULT_SETTINGS: FabricPluginSettings = {
    fabricPath: 'fabric',
    ffmpegPath: 'ffmpeg',
    outputFolder: ''
}

export default class FabricPlugin extends Plugin {
    settings: FabricPluginSettings;

    async onload() {
        await this.loadSettings();
        await this.checkFabricAvailability();
        await this.checkFFmpegAvailability();

        this.addSettingTab(new FabricSettingTab(this.app, this));

        this.registerView('fabric-view', (leaf) => new FabricView(leaf, this));

        this.addRibbonIcon('dice', 'fabric', () => {
            this.activateView();
        });
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }
  
    async checkFabricAvailability() {
        try {
            const patterns = await this.runFabricCommand('--list');
            console.log(`Fabric patterns available: ${patterns}`);
        } catch (error) {
            console.error('Error checking Fabric availability:', error);
            new Notice('Fabric not found. Please check the path in plugin settings.');
        }
    }
  
    async checkFFmpegAvailability() {
      try {
          const { stdout, stderr } = await execAsync(`"${this.settings.ffmpegPath}" -version`);
          if (stderr) {
              console.error('FFmpeg test error:', stderr);
              new Notice('FFmpeg not found. Please check the path in plugin settings.');
          } else {
              console.log(`FFmpeg version: ${stdout.trim()}`);
          }
      } catch (error) {
          console.error('Error checking FFmpeg availability:', error);
          new Notice('FFmpeg not found. Please check the path in plugin settings.');
      }
    }

    async getDefaultShell(): Promise<string> {
        if (os.platform() === 'win32') {
            return 'cmd.exe';
        }
        try {
            const { stdout } = await execAsync('echo $SHELL');
            return stdout.trim();
        } catch (error) {
            console.error('Failed to detect default shell:', error);
            return '/bin/sh'; // Fallback to /bin/sh
        }
    }

    async runFabricCommand(args: string): Promise<string> {
        try {
            const shell = await this.getDefaultShell();
            const command = `"${this.settings.fabricPath}" ${args}`;
            console.log(`Executing command: ${command}`);
            const { stdout, stderr } = await execAsync(command, { shell });
            if (stderr) {
                console.warn('Fabric command stderr:', stderr);
            }
            return stdout.trim();
        } catch (error) {
            console.error('Error running fabric command:', error);
            throw error;
        }
    }

    async activateView() {
      const { workspace } = this.app;

      let leaf = workspace.getLeavesOfType('fabric-view')[0];
      
      if (!leaf) {
        leaf = workspace.getLeaf('split');
          await leaf.setViewState({
              type: 'fabric-view',
              active: true,
          });
      }

      leaf = workspace.getLeavesOfType('fabric-view')[0];
      
      if (leaf) {
          workspace.revealLeaf(leaf);
      } else {
          new Notice('Failed to open Fabric view');
      }
  }
}


class FabricView extends ItemView {
  plugin: FabricPlugin;
  patterns: string[] = [];
  patternDropdown: HTMLElement;
  searchInput: HTMLInputElement;
  outputNoteInput: HTMLInputElement;
  selectedOptionIndex: number = -1;
  buttonsContainer: HTMLElement;
  progressSpinner: HTMLElement;
  patternsSyncContainer: HTMLElement;
  patternsSyncButton: HTMLElement;
  containerEl: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: FabricPlugin) {
      super(leaf);
      this.plugin = plugin;
  }

  getViewType(): string {
      return 'fabric-view';
  }

  getDisplayText(): string {
      return 'Fabric';
  }

  async onOpen() {
      this.containerEl = this.contentEl;
      this.containerEl.empty();
      this.containerEl.addClass('fabric-view');

      const logoContainer = this.containerEl.createEl('div', { cls: 'fabric-logo-container' });
      const logo = logoContainer.createEl('img', {
          cls: 'fabric-logo',
          attr: { src: 'https://github.com/danielmiessler/fabric/blob/main/images/fabric-logo-gif.gif?raw=true' }
      });

      const contentContainer = this.containerEl.createEl('div', { cls: 'fabric-content' });

      contentContainer.createEl('h3', { text: 'fabric', cls: 'fabric-title' });

      this.buttonsContainer = contentContainer.createEl('div', { cls: 'fabric-buttons' });
      const currentNoteBtn = this.buttonsContainer.createEl('button', { text: 'Current Note', cls: 'fabric-button current-note' });
      const clipboardBtn = this.buttonsContainer.createEl('button', { text: 'Clipboard', cls: 'fabric-button clipboard' });

      currentNoteBtn.onclick = () => this.runFabric('current');
      clipboardBtn.onclick = () => this.runFabric('clipboard');

      const inputsContainer = contentContainer.createEl('div', { cls: 'fabric-inputs-container' });

      this.outputNoteInput = inputsContainer.createEl('input', {
          cls: 'fabric-input',
          attr: { type: 'text', placeholder: 'Output note name' }
      });

      this.searchInput = inputsContainer.createEl('input', {
          cls: 'fabric-input',
          attr: { type: 'text', placeholder: 'Search patterns...' }
      });

      this.patternDropdown = contentContainer.createEl('div', { cls: 'fabric-dropdown' });

      this.searchInput.addEventListener('input', () => {
          this.updatePatternOptions(this.searchInput.value.toLowerCase());
      });

      this.searchInput.addEventListener('keydown', (event) => {
          this.handleDropdownNavigation(event);
      });

      this.searchInput.addEventListener('focus', () => {
          this.searchInput.classList.add('active');
      });

      this.searchInput.addEventListener('blur', () => {
          this.searchInput.classList.remove('active');
      });

      this.outputNoteInput.addEventListener('focus', () => {
          this.outputNoteInput.classList.add('active');
      });

      this.outputNoteInput.addEventListener('blur', () => {
          this.outputNoteInput.classList.remove('active');
      });

      this.progressSpinner = contentContainer.createEl('div', { cls: 'fabric-progress-spinner' });

      await this.loadPatterns();
      this.updatePatternOptions('');
      this.searchInput.focus();
  }

    async runFabric(source: 'current' | 'clipboard' | 'pattern') {
        let input = '';
        let pattern = this.searchInput.value.trim();
        let outputNoteName = this.outputNoteInput.value.trim();

        if (source === 'current') {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                input = await this.app.vault.read(activeFile);
            }
        } else if (source === 'clipboard') {
            input = await navigator.clipboard.readText();
        } else if (source === 'pattern') {
            if (!pattern) {
                new Notice('Please select a pattern first');
                return;
            }
        }

        this.progressSpinner.addClass('active');

        try {
            const output = await this.plugin.runFabricCommand(`--text "${input}" -sp "${pattern}"`);
            const newFile = await this.createOutputNote(output, outputNoteName);
            this.progressSpinner.removeClass('active');
            this.app.workspace.openLinkText(newFile.path, '', true);
            new Notice('Fabric output generated successfully');
        } catch (error) {
            console.error('Failed to run fabric:', error);
            this.progressSpinner.removeClass('active');
            new Notice('Failed to run fabric. Please check your settings and try again.');
        }
    }

    async createOutputNote(content: string, noteName: string): Promise<TFile> {
      let fileName = `${noteName}.md`;
      let filePath = path.join(this.plugin.settings.outputFolder, fileName);
      let fileExists = await this.app.vault.adapter.exists(filePath);
      let counter = 1;

      while (fileExists) {
          fileName = `${noteName} (${counter}).md`;
          filePath = path.join(this.plugin.settings.outputFolder, fileName);
          fileExists = await this.app.vault.adapter.exists(filePath);
          counter++;
      }

      return await this.app.vault.create(filePath, content);
    }

    updatePatternOptions(query: string) {
        this.patternDropdown.empty();
        this.selectedOptionIndex = -1;

        const filteredPatterns = fuzzaldrin.filter(this.patterns, query);

        if (filteredPatterns.length === 0) {
            this.patternDropdown.createEl('div', {
                cls: 'fabric-dropdown-option',
                text: 'No patterns found'
            });
        } else {
            filteredPatterns.forEach((pattern, index) => {
                const option = this.patternDropdown.createEl('div', {
                    cls: `fabric-dropdown-option ${index === 0 ? 'selected' : ''}`,
                    text: pattern
                });
                option.addEventListener('click', () => {
                    this.searchInput.value = pattern;
                    this.patternDropdown.empty();
                    this.runFabric('pattern');
                });
            });
            this.selectedOptionIndex = 0;
        }

        const dropdownRect = this.patternDropdown.getBoundingClientRect();
        const inputRect = this.searchInput.getBoundingClientRect();

        this.patternDropdown.style.top = `${inputRect.bottom}px`;
        this.patternDropdown.style.left = `${inputRect.left}px`;
        this.patternDropdown.style.width = `${inputRect.width}px`;
    }

    handleDropdownNavigation(event: KeyboardEvent) {
        if (this.patternDropdown.childElementCount === 0) return;

        switch (event.key) {
            case 'ArrowUp':
                this.navigateDropdownOptions(-1);
                event.preventDefault();
                break;
            case 'ArrowDown':
                this.navigateDropdownOptions(1);
                event.preventDefault();
                break;
            case 'Enter':
                this.selectCurrentOption();
                event.preventDefault();
                break;
        }
    }

    navigateDropdownOptions(direction: number) {
        const options = Array.from(this.patternDropdown.children) as HTMLElement[];
        const optionsCount = options.length;

        if (optionsCount === 0) return;

        this.selectedOptionIndex = (this.selectedOptionIndex + direction + optionsCount) % optionsCount;

        options.forEach((option, index) => {
            if (index === this.selectedOptionIndex) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    }

    selectCurrentOption() {
        const selectedOption = this.patternDropdown.children[this.selectedOptionIndex] as HTMLElement;
        if (selectedOption) {
            const pattern = selectedOption.textContent!;
            this.searchInput.value = pattern;
            this.patternDropdown.empty();
        }
    }

    async loadPatterns() {
        try {
            const output = await this.plugin.runFabricCommand('--list');
            this.patterns = output.split('\n').filter(Boolean);
        } catch (error) {
            console.error('Failed to load fabric patterns:', error);
            new Notice('Failed to load fabric patterns. Please check your fabric installation.');
        }
    }
}

class FabricSettingTab extends PluginSettingTab {
  plugin: FabricPlugin;

  constructor(app: App, plugin: FabricPlugin) {
      super(app, plugin);
      this.plugin = plugin;
  }

  display(): void {
      const { containerEl } = this;
      containerEl.empty();
      containerEl.createEl('h2', { text: 'Fabric Settings' });

      new Setting(containerEl)
        .setName ('Fabric Path')
        .setDesc('Path to the fabric executable. If fabric is not found, provide  the full path.')
        .addText (text => text
          .setPlaceholder ('/path/to/fabric')
          .setValue(this.plugin.settings.fabricPath)
          .onChange (async (value) => {
            this.plugin.settings.fabricPath = value;
            await this.plugin.saveSettings();
      }));
    
      new Setting(containerEl)
          .setName('FFmpeg Path')
          .setDesc('Path to the FFmpeg executable. If FFmpeg is not found, provide the full path.')
          .addText(text => text
              .setPlaceholder('/path/to/ffmpeg')
              .setValue(this.plugin.settings.ffmpegPath)
              .onChange(async (value) => {
                  this.plugin.settings.ffmpegPath = value;
                  await this.plugin.saveSettings();
              }));

      // Add help text
      const helpText = this.getHelpText();
      const helpDiv = containerEl.createEl('div', { cls: 'fabric-help-text' });
      MarkdownRenderer.render(this.app, helpText, helpDiv, '', this.plugin);

      new Setting(containerEl)
          .setName('Output Folder')
          .setDesc('Folder to save fabric output notes')
          .addText(text => text
              .setPlaceholder('Enter folder path')
              .setValue(this.plugin.settings.outputFolder)
              .onChange(async (value) => {
                  this.plugin.settings.outputFolder = value;
                  await this.plugin.saveSettings();
              }));

      const fabricTestButton = new Setting(containerEl)
          .setName('Test Fabric Installation')
          .setDesc('Check if fabric is correctly installed');

      const fabricTestResult = fabricTestButton.controlEl.createEl('span', {
          cls: 'test-result',
          text: ''
      });

      fabricTestButton.addButton(btn => btn
          .setButtonText('Test')
          .onClick(async () => {
              try {
                  const patterns = await this.plugin.runFabricCommand('--list');
                  const patternCount = patterns.split('\n').filter(Boolean).length;
                  new Notice(`Fabric is correctly installed. ${patternCount} patterns available.`);
                  fabricTestResult.setText('✅');
              } catch (error) {
                  console.error('Error testing Fabric:', error);
                  new Notice('Failed to detect fabric. Please check the path in settings.');
                  fabricTestResult.setText('❌');
              }
          }));

      const ffmpegTestButton = new Setting(containerEl)
          .setName('Test FFmpeg Installation')
          .setDesc('Check if FFmpeg is correctly installed');

      const ffmpegTestResult = ffmpegTestButton.controlEl.createEl('span', {
          cls: 'test-result',
          text: ''
      });

      ffmpegTestButton.addButton(btn => btn
          .setButtonText('Test')
          .onClick(async () => {
              try {
                  const { stdout, stderr } = await execAsync(`"${this.plugin.settings.ffmpegPath}" -version`);
                  if (stderr) {
                      console.error('FFmpeg test error:', stderr);
                      new Notice('Failed to detect FFmpeg. Please check the path in settings.');
                      ffmpegTestResult.setText('❌');
                  } else {
                      new Notice(`FFmpeg is correctly installed. ${stdout.trim()}`);
                      ffmpegTestResult.setText('✅');
                  }
              } catch (error) {
                  console.error('Error testing FFmpeg:', error);
                  new Notice('Failed to detect FFmpeg. Please check the path in settings.');
                  ffmpegTestResult.setText('❌');
              }
          }));
  }

  getHelpText(): string {
    const platform = os.platform();
    let helpText = "If fabric or FFmpeg is installed for the user instead of globally, provide the full path to the binary.\n\n";

    switch (platform) {
        case 'darwin':
            helpText += "On macOS:\n" +
                "1. Open Terminal\n" +
                "2. Run `which fabric` or `which ffmpeg`\n" +
                "3. Copy the output path and paste it above\n" +
                "The default fabric patterns folder is ~/.config/fabric/patterns\n";
            break;
        case 'linux':
            helpText += "On Linux:\n" +
                "1. Open Terminal\n" +
                "2. Run `which fabric` or `which ffmpeg`\n" +
                "3. Copy the output path and paste it above\n" +
                "The default fabric patterns folder is ~/.config/fabric/patterns\n";
            break;
        case 'win32':
            helpText += "On Windows:\n" +
                "1. Open Command Prompt\n" +
                "2. Run `where fabric` or `where ffmpeg`\n" +
                "3. Copy the output path and paste it above\n" +
                "The default fabric patterns folder is %APPDATA%\\fabric\\patterns\n";
            break;
        default:
            helpText += "To find the fabric or FFmpeg path:\n" +
                "1. Open a terminal or command prompt\n" +
                "2. Run the appropriate command to locate fabric or FFmpeg (e.g., `which fabric`, `which ffmpeg`, `where fabric`, or `where ffmpeg`)\n" +
                "3. Copy the output path and paste it above\n" +
                "The default fabric patterns folder is ~/.config/fabric/patterns (macOS/Linux) or %APPDATA%\\fabric\\patterns (Windows)\n";
    }

    return helpText;
  }
}