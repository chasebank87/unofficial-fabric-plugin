import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, Notice, ItemView, MarkdownRenderer, setIcon, Modal } from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fuzzaldrin from 'fuzzaldrin-plus';

const shellEscape = require('shell-escape');
const apiURL = 'http://localhost:49152/';
const execAsync = promisify(exec);

interface FabricPluginSettings {
    fabricPath: string;
    ffmpegPath: string;
    outputFolder: string;
    youtubeAutodetectEnabled: boolean;
}

const DEFAULT_SETTINGS: FabricPluginSettings = {
    fabricPath: 'fabric',
    ffmpegPath: 'ffmpeg',
    outputFolder: '',
    youtubeAutodetectEnabled: true
}

export default class FabricPlugin extends Plugin {
    settings: FabricPluginSettings;

    async onload() {
        await this.loadSettings();
        await this.checkFabricAvailability();
        await this.checkFFmpegAvailability();

        this.addSettingTab(new FabricSettingTab(this.app, this));

        this.registerView('fabric-view', (leaf) => new FabricView(leaf, this));

        this.addRibbonIcon('brain', 'fabric', () => {
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

    async runFabricCommand(args: string, input?: string): Promise<string> {
      try {
          const shell = await this.getDefaultShell();
          let command = `"${this.settings.fabricPath}" ${args}`;
          
          if (input) {
              // Escape the input to handle special characters
              const escapedInput = shellEscape([input]);
              command += ` --text ${escapedInput}`;
          }

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
  refreshButton: HTMLElement;
  logoContainer: HTMLElement;
  loadingText: HTMLElement;
  ytSwitch: HTMLInputElement;
  ytToggle: HTMLElement;

  loadingMessages: string[] = [
    "reticulating splines...",
    "engaging warp drive...",
    "calibrating flux capacitor...",
    "compiling techno-babble...",
    "reversing the polarity...",
    "bypassing the mainframe...",
    "initializing neural network...",
    "decrypting alien transmissions...",
    "charging photon torpedoes...",
    "hacking the gibson..."
  ];

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

      this.logoContainer = this.containerEl.createEl('div', { cls: 'fabric-logo-container' });
        const logo = this.logoContainer.createEl('img', {
            cls: 'fabric-logo',
            attr: { 
                src: this.plugin.app.vault.adapter.getResourcePath(this.plugin.manifest.dir + '/fabric-logo-gif.gif')
            }
        });
      this.loadingText = this.logoContainer.createEl('div', { cls: 'fabric-loading-text' });

      const contentContainer = this.containerEl.createEl('div', { cls: 'fabric-content' });

   // Add YouTube toggle and icon
   const ytToggleContainer = contentContainer.createEl('div', { cls: 'fabric-yt-toggle-container' });
    
   // Create toggle
   this.ytToggle = ytToggleContainer.createEl('div', { 
    cls: `fabric-yt-toggle ${this.plugin.settings.youtubeAutodetectEnabled ? 'active' : ''}`
});
   const toggleSlider = this.ytToggle.createEl('span', { cls: 'fabric-yt-toggle-slider' });
   
    // Create text label
    const ytLabel = ytToggleContainer.createEl('span', { 
        cls: 'fabric-yt-label',
        text: 'Autodetect YouTube Links'
    });


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

      this.ytToggle.addEventListener('click', () => {
        this.ytToggle.classList.toggle('active');
        this.plugin.settings.youtubeAutodetectEnabled = this.ytToggle.classList.contains('active');
        this.plugin.saveSettings();
        if (this.plugin.settings.youtubeAutodetectEnabled) {
            new Notice('YouTube link detection enabled');
        } else {
            new Notice('YouTube link detection disabled');
        }
    });
      
    // Modify the click handlers for currentNoteBtn and clipboardBtn
    currentNoteBtn.onclick = () => this.handleFabricRun('current');
    clipboardBtn.onclick = () => this.handleFabricRun('clipboard');

    
      this.refreshButton = contentContainer.createEl('button', {
        cls: 'fabric-refresh-button',
        attr: {
            'aria-label': 'Refresh patterns'
        }
      });
      setIcon(this.refreshButton, 'refresh-cw');
      this.refreshButton.onclick = async () => {
          await this.loadPatterns();
          new Notice('Patterns refreshed');
      };


    this.progressSpinner = contentContainer.createEl('div', { cls: 'fabric-progress-spinner' });
    

      await this.loadPatterns();
      this.updatePatternOptions('');
      this.searchInput.focus();
  }

  async runFabric(source: 'current' | 'clipboard' | 'pattern') {
    let data = '';
    let pattern = this.searchInput.value.trim();
    let outputNoteName = this.outputNoteInput.value.trim();
    
    if (source === 'current') {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            data = await this.app.vault.read(activeFile);
        }
    } else if (source === 'clipboard') {
        data = await navigator.clipboard.readText();
    } else if (source === 'pattern') {
        if (!pattern) {
            new Notice('Please select a pattern first');
            return;
        }
    }

    this.logoContainer.addClass('loading');
    this.loadingText.setText('');
    this.animateLoadingText(this.getRandomLoadingMessage());

    try {
        const response = await fetch(apiURL + 'fabric', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json'
            },
            body: JSON.stringify({
                pattern: pattern,
                data: data
            })
        });

        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        const responseData = await response.json();
        const output = responseData.output;

        const newFile = await this.createOutputNote(output, outputNoteName);
        this.logoContainer.removeClass('loading');
        this.loadingText.setText('');
        this.app.workspace.openLinkText(newFile.path, '', true);
        new Notice('Fabric output generated successfully');
    } catch (error) {
        console.error('Failed to run fabric:', error);
        this.logoContainer.removeClass('loading');
        this.loadingText.setText('');
        new Notice('Failed to run fabric. Please check your settings and try again.');
    }
}

      getRandomLoadingMessage(): string {
        return this.loadingMessages[Math.floor(Math.random() * this.loadingMessages.length)];
      }

      animateLoadingText(text: string) {
        let i = 0;
        const intervalId = setInterval(() => {
            if (!this.logoContainer.hasClass('loading')) {
                clearInterval(intervalId);
                return;
            }
            if (i < text.length) {
                this.loadingText.setText(this.loadingText.getText() + text[i]);
                i++;
            } else {
                setTimeout(() => {
                    this.loadingText.setText('');
                    i = 0;
                }, 1000); // Pause for a second before restarting
            }
        }, 100); // Adjust this value to change the typing speed
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
            const response = await fetch(apiURL + 'patterns');
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            
            // Extract pattern names from the JSON structure
            this.patterns = data.data.patterns.map((pattern: { name: any; }) => pattern.name);
            
            console.log('Patterns loaded:', this.patterns);
        } catch (error) {
            console.error('Failed to load patterns from API:', error);
            new Notice('Failed to load patterns. Please check the API server.');
        }
    }

    async handleFabricRun(source: 'current' | 'clipboard') {
        if (this.ytToggle.classList.contains('active')) {
            const links = await this.extractYouTubeLinks(source);
            if (links.length > 0) {
                this.showYouTubeModal(links, source);
            } else {
                new Notice('No YouTube links found. Running Fabric normally.');
                this.runFabric(source);
            }
        } else {
            this.runFabric(source);
        }
    }

    async extractYouTubeLinks(source: 'current' | 'clipboard'): Promise<string[]> {
        let text = '';
        if (source === 'current') {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                text = await this.app.vault.read(activeFile);
            }
        } else {
            text = await navigator.clipboard.readText();
        }
        const youtubeRegex = /(?:https?:\/\/)?(?:www\.)?(?:youtube\.com|youtu\.be)\/(?:watch\?v=)?(?:embed\/)?(?:v\/)?(?:shorts\/)?(?:\S+)/g;
        return text.match(youtubeRegex) || [];
    }

    showYouTubeModal(links: string[], source: 'current' | 'clipboard') {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Select YouTube Link');
        const { contentEl } = modal;
    
        let selectedIndex = 0;
    
        const linkList = contentEl.createEl('div', { cls: 'fabric-yt-link-list' });
    
        const updateSelection = () => {
            linkList.querySelectorAll('.fabric-yt-link').forEach((el, index) => {
                el.classList.toggle('is-selected', index === selectedIndex);
            });
        };
    
        links.forEach((link, index) => {
            const linkEl = linkList.createEl('div', { cls: 'fabric-yt-link', text: link });
            linkEl.addEventListener('click', () => {
                selectedIndex = index;
                updateSelection();
            });
        });
    
        const buttonContainer = contentEl.createEl('div', { cls: 'fabric-yt-modal-buttons' });
        const skipButton = buttonContainer.createEl('button', { text: 'Skip' });
        skipButton.addClass('skip-button');
        const runYTButton = buttonContainer.createEl('button', { text: 'Run' });
        runYTButton.addClass('run-button');

        skipButton.addEventListener('click', () => {
            modal.close();
            this.runFabric(source);
        });
    
        runYTButton.addEventListener('click', () => {
            modal.close();
            if (links.length > 0) {
                this.runYT(links[selectedIndex]);
            } else {
                new Notice('No YouTube links found');
            }
        });
    
        modal.onOpen = () => {
            updateSelection();
            
            const handleKeyDown = (event: KeyboardEvent) => {
                switch (event.key) {
                    case 'ArrowUp':
                        selectedIndex = (selectedIndex - 1 + links.length) % links.length;
                        updateSelection();
                        event.preventDefault();
                        break;
                    case 'ArrowDown':
                        selectedIndex = (selectedIndex + 1) % links.length;
                        updateSelection();
                        event.preventDefault();
                        break;
                    case 'Enter':
                        modal.close();
                        this.runYT(links[selectedIndex]);
                        event.preventDefault();
                        break;
                }
            };
    
            document.addEventListener('keydown', handleKeyDown);
            modal.onClose = () => {
                document.removeEventListener('keydown', handleKeyDown);
            };
        };
    
        modal.open();
    }
    

    async runYT(url: string) {
        let outputNoteName = this.outputNoteInput.value.trim();
        const pattern = this.searchInput.value.trim();
        if (!pattern) {
            new Notice('Please select a pattern first');
            return;
        }

        this.logoContainer.addClass('loading');
        this.loadingText.setText('');
        this.animateLoadingText(this.getRandomLoadingMessage());
    
    
        try {
            const response = await fetch(apiURL + 'yt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({
                    pattern: pattern,
                    url: url
                }),
            });
    
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
    
            const data = await response.json();
            const output = data.output;
    
            const newFile = await this.createOutputNote(output, outputNoteName);
            this.logoContainer.removeClass('loading');
            this.loadingText.setText('');
            this.app.workspace.openLinkText(newFile.path, '', true);
            new Notice('YouTube Fabric output generated successfully');
        } catch (error) {
            console.error('Failed to run YouTube Fabric:', error);
            new Notice('Failed to run YouTube Fabric. Please check your settings and try again.');
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