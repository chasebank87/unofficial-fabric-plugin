import { App, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, ItemView, MarkdownRenderer, setIcon, Modal, ViewState} from 'obsidian';
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
    customPatternsFolder: string;
    youtubeAutodetectEnabled: boolean;
    defaultModel: string;
    debug: boolean;
}

const DEFAULT_SETTINGS: FabricPluginSettings = {
    fabricPath: 'fabric',
    ffmpegPath: 'ffmpeg',
    outputFolder: '',
    customPatternsFolder: '',
    youtubeAutodetectEnabled: true,
    defaultModel: '',
    debug: false
}

export default class FabricPlugin extends Plugin {
    settings: FabricPluginSettings;
    customPatternsFolder: TFolder | null = null;
    patterns: string[] = [];
    debug: boolean;

    async onload() {
        await this.loadSettings();
        this.updateLogging();
        await this.loadSettings();
        await this.checkFabricAvailability();
        await this.checkFFmpegAvailability();
        this.registerCustomPatternsFolderWatcher();

        this.app.workspace.onLayoutReady(() => {
            this.registerCustomPatternsFolderWatcher();
        });

        this.addSettingTab(new FabricSettingTab(this.app, this));

        this.registerView(
            'fabric-view',
            (leaf) => new FabricView(leaf, this)
        );
        if (this.app.workspace.layoutReady) {
            this.initLeaf();
        } else {
            this.app.workspace.onLayoutReady(this.initLeaf.bind(this));
        }

        this.addRibbonIcon('brain', 'Fabric', () => {
            this.activateView();
        });
    }

    private isLogging = false;

    log(message: string, ...args: any[]) {
        if (this.settings.debug && !this.isLogging) {
            this.isLogging = true;
            console.log(`[Fabric Debug] ${message}`, ...args);
            this.isLogging = false;
        }
    }

    initLeaf(): void {
        if (this.app.workspace.getLeavesOfType('fabric-view').length) {
            return;
        }
        const rightLeaf = this.app.workspace.getRightLeaf(false);
        if (rightLeaf) {
            rightLeaf.setViewState({
                type: 'fabric-view',
                active: true,
            });
        }
    }


    updateLogging() {
        if (this.settings.debug) {
            console.log('[Fabric] Debug mode enabled');
        } else {
            console.log('[Fabric] Debug mode disabled');
        }
    }

    async loadSettings() {
        this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    }

    async saveSettings() {
        await this.saveData(this.settings);
    }

    registerCustomPatternsFolderWatcher() {
        this.log("Registering custom patterns folder watcher");
        // Unregister previous watcher if exists
        this.app.vault.off('delete', this.handleFileDeletion);
    
        if (this.settings.customPatternsFolder) {
            const folderPath = this.settings.customPatternsFolder.endsWith('/') 
                ? this.settings.customPatternsFolder 
                : this.settings.customPatternsFolder + '/';
            
            this.log(`Watching for deletions in: ${folderPath}`);
            
            this.registerEvent(
                this.app.vault.on('delete', this.handleFileDeletion)
            );
        } else {
            console.warn('Custom patterns folder path not set in settings');
        }
    }
    

    handleFileDeletion = (file: TAbstractFile) => {
        this.log(`File deletion detected: ${file.path}`);
        this.log(`Custom patterns folder: ${this.settings.customPatternsFolder}`);
        
        if (!(file instanceof TFile)) {
            this.log("Deleted item is not a file");
            return;
        }
        
        // Check if the file is directly in the custom patterns folder
        const customPatternsPath = this.settings.customPatternsFolder.endsWith('/') 
            ? this.settings.customPatternsFolder 
            : this.settings.customPatternsFolder + '/';
        
        if (!file.path.startsWith(customPatternsPath)) {
            this.log("File is not in the custom patterns folder");
            return;
        }
        
        if (file.extension !== 'md') {
            this.log("File is not a markdown file");
            return;
        }
    
        this.log(`Markdown file deleted in custom patterns folder: ${file.path}`);
        this.handleCustomPatternDeletion(file.name);
    };

    async handleCustomPatternDeletion(fileName: string) {
        this.log(`Handling custom pattern deletion for: ${fileName}`);
        const patternName = fileName.replace('.md', '');
        const confirmDelete = await this.confirmPatternDeletion(patternName);
        if (confirmDelete) {
            await this.deletePatternFromFabric(patternName);
        }
    }

    async confirmPatternDeletion(patternName: string): Promise<boolean> {
        return new Promise((resolve) => {
            const notice = new Notice('', 0);
            const container = notice.noticeEl.createDiv('fabric-confirm-deletion');
            
            container.createEl('h3', { text: 'Confirm Pattern Deletion' });
            container.createEl('p', { text: `Do you want to delete the pattern "${patternName}" and its folder from Fabric as well?` });
            
            const buttonContainer = container.createDiv('fabric-confirm-buttons');
            
            const yesButton = buttonContainer.createEl('button', { text: 'Yes' });
            yesButton.onclick = () => {
                notice.hide();
                resolve(true);
            };
            
            const noButton = buttonContainer.createEl('button', { text: 'No' });
            noButton.onclick = () => {
                notice.hide();
                resolve(false);
            };
        });
    }

    async deletePatternFromFabric(patternName: string) {
        try {
            const response = await fetch(apiURL + 'delete_pattern', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ pattern: patternName }),
            });
    
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
    
            const result = await response.json();
            new Notice(result.message);
    
            // Reload patterns after successful deletion
            await this.updateFabricView();
        } catch (error) {
            console.error('Error deleting pattern from Fabric:', error);
            new Notice(`Failed to delete pattern "${patternName}" from Fabric.`);
        }
    }


    updateFabricView() {
        // Find and update the FabricView if it exists
        this.app.workspace.iterateAllLeaves((leaf) => {
            if (leaf.view instanceof FabricView) {
                (leaf.view as FabricView).loadPatterns();
            }
        });
    }

  
    async checkFabricAvailability() {
        try {
            const patterns = await this.runFabricCommand('--list');
            this.log(`Fabric patterns available: ${patterns}`);
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
              this.log(`FFmpeg version: ${stdout.trim()}`);
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

          this.log(`Executing command: ${command}`);
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
    this.app.workspace.detachLeavesOfType('fabric-view');

    const rightLeaf = this.app.workspace.getRightLeaf(false);
    if (rightLeaf) {
        rightLeaf.setViewState({
            type: 'fabric-view',
            active: true,
        });
    }

    this.app.workspace.revealLeaf(
        this.app.workspace.getLeavesOfType('fabric-view')[0]
    );
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
    modelSearchInput: HTMLInputElement;
    modelDropdown: HTMLElement;
    models: string[] = [];
    selectedModelIndex: number = -1;
    defaultModelDisplay: HTMLElement;
    modelNameSpan: HTMLSpanElement;
    syncButton: HTMLElement;

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
        "hacking the gibson...",
        "Warming flux capacitor...",
        "Downloading more RAM...",
        "Reversing neutron flow...",
        "Initializing sass protocol...",
        "Calibrating sarcasm sensors...",
        "Bypassing laws of physics...",
        "Generating witty message...",
        "Spinning hamster wheels...",
        "Charging sonic screwdriver...",
        "Aligning the stars...",
        "Dividing by zero...",
        "Upgrading to Windows 9...",
        "Searching for life's meaning...",
        "Awaiting the Singularity...",
        "Tuning alien frequencies...",
        "Bending space-time continuum...",
        "Compiling crash excuses...",
        "Calculating success probability...",
        "Rolling for initiative...",
        "Initiating self-destruct sequence...",
        "Summoning IT gods...",
        "Applying warp core tape...",
        "Translating binary to dance...",
        "Charging Arc Reactor..."
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
  
      this.modelSearchInput = inputsContainer.createEl('input', {
          cls: 'fabric-input',
          attr: {
              type: 'text',
              placeholder: 'Search models...',
          }
          
      });
  
      this.patternDropdown = contentContainer.createEl('div', { cls: 'fabric-dropdown' , attr: { id: 'pattern-dropdown' }} );
      this.modelDropdown = contentContainer.createEl('div', { cls: 'fabric-dropdown', attr: { id: 'model-dropdown' }});
  
      this.searchInput.addEventListener('input', () => {
          this.updatePatternOptions(this.searchInput.value.toLowerCase());
      });
  
      this.modelSearchInput.addEventListener('input', () => {
          this.updateModelOptions(this.modelSearchInput.value.toLowerCase());
          this.updatePoweredByText(this.modelSearchInput.value);
      });
  
      this.searchInput.addEventListener('keydown', (event) => {
          this.handleDropdownNavigation(event, this.patternDropdown, this.searchInput);
      });
  
      this.modelSearchInput.addEventListener('keydown', (event) => {
          this.handleDropdownNavigation(event, this.modelDropdown, this.modelSearchInput);
      });
        
    // Create the default model display
    this.defaultModelDisplay = contentContainer.createEl('div', { cls: 'fabric-default-model' });
    this.defaultModelDisplay.createSpan({ text: 'Powered by ' });
    this.modelNameSpan = this.defaultModelDisplay.createSpan({ cls: 'model-name' });
    this.updatePoweredByText(this.plugin.settings.defaultModel || 'No default model set');
  
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
        

    const buttonContainer = contentContainer.createEl('div', { cls: 'fabric-button-container' });

    this.refreshButton = buttonContainer.createEl('button', {
        cls: 'fabric-icon-button fabric-refresh-button',
        attr: {
            'aria-label': 'Refresh patterns and models'
        }
    });
    setIcon(this.refreshButton, 'refresh-cw');
    this.refreshButton.onclick = async () => {
        await this.loadPatterns();
        await this.loadModels();
        new Notice('Patterns and models refreshed');
    };

    this.syncButton = buttonContainer.createEl('button', {
        cls: 'fabric-icon-button fabric-sync-button',
        attr: {
            'aria-label': 'Sync custom patterns'
        }
    });
    setIcon(this.syncButton, 'upload-cloud');
    this.syncButton.onclick = async () => {
        await this.syncCustomPatterns();
    };
  


    this.progressSpinner = contentContainer.createEl('div', { cls: 'fabric-progress-spinner' });
    

        await this.loadPatterns();
        await this.loadModels();
        this.updatePatternOptions('');
        this.updateModelOptions('');
        this.searchInput.focus();
  }

  async runFabric(source: 'current' | 'clipboard' | 'pattern') {
    let data = '';
    let pattern = this.searchInput.value.trim();
    let outputNoteName = this.outputNoteInput.value.trim();
    const model = this.getCurrentModel();
      
    if (!model) {
        new Notice('Please select a model or set a default model in settings before running.');
        return;
    }
    
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
                model: model,
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
    
        const newFile = await this.app.vault.create(filePath, content);
    
        // Get the most recently focused leaf in the main workspace
        const activeLeaf = this.app.workspace.getMostRecentLeaf();
    
        if (activeLeaf && !activeLeaf.getViewState().pinned) {
            // If there's an active leaf and it's not pinned, create a new leaf in split
            const newLeaf = this.app.workspace.createLeafBySplit(activeLeaf, 'vertical');
            await newLeaf.openFile(newFile);
        } else {
            // If there's no active leaf or it's pinned, create a new leaf
            const newLeaf = this.app.workspace.getLeaf('tab');
            await newLeaf.openFile(newFile);
        }
    
        return newFile;
    }
    
    
    

    updatePatternOptions(query: string) {
        this.patternDropdown.empty();
        this.selectedOptionIndex = -1;
    
        if (query === '') return; // Don't show options if the input is empty
    
        const filteredPatterns = fuzzaldrin.filter(this.patterns, query);
    
        if (filteredPatterns.length === 0 && query !== '') {
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
    
updateModelOptions(query: string) {
    this.modelDropdown.empty();
    this.selectedModelIndex = -1;

    if (query === '') return;

    const filteredModels = fuzzaldrin.filter(this.models, query);

    if (filteredModels.length === 0 && query !== '') {
        this.modelDropdown.createEl('div', {
            cls: 'fabric-dropdown-option',
            text: 'No models found'
        });
    } else {
        filteredModels.forEach((model, index) => {
            const option = this.modelDropdown.createEl('div', {
                cls: `fabric-dropdown-option ${index === 0 ? 'selected' : ''}`,
                text: model
            });
            option.addEventListener('click', () => {
                this.selectModel(model);
            });
        });
        this.selectedModelIndex = 0;
    }
}

selectModel(model: string) {
    this.modelSearchInput.value = model;
    this.modelDropdown.empty();
    this.updatePoweredByText(model);
}

updatePoweredByText(model: string) {
    const displayModel = model || this.plugin.settings.defaultModel || 'No model selected';
    
    if (this.modelNameSpan.textContent !== displayModel) {
        this.modelNameSpan.setText(displayModel);
        this.modelNameSpan.addClass('updating');
        
        setTimeout(() => {
            this.modelNameSpan.removeClass('updating');
        }, 500); // This should match the animation duration
    }
}
    
updateDefaultModelDisplay() {
    this.updatePoweredByText(this.modelSearchInput.value);
}

getCurrentModel(): string {
    return this.modelSearchInput.value || this.plugin.settings.defaultModel;
}

async loadModels() {
    try {
        const response = await fetch(apiURL + 'models');
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        this.models = data.data.models.map((model: { name: any; }) => model.name);
        this.plugin.log('Models loaded:', this.models);
        this.updateDefaultModelDisplay();
    } catch (error) {
        this.plugin.log('Failed to load models from API:', error);
        new Notice('Failed to load models. Please check the API server.');
    }
}
    
handleDropdownNavigation(event: KeyboardEvent, dropdown: HTMLElement, input: HTMLInputElement) {
    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            this.navigateDropdownOptions(1, dropdown);
            break;
        case 'ArrowUp':
            event.preventDefault();
            this.navigateDropdownOptions(-1, dropdown);
            break;
        case 'Enter':
            event.preventDefault();
            this.selectCurrentOption(dropdown, input);
            break;
    }
}


    navigateDropdownOptions(direction: number, dropdown: HTMLElement) {
        const options = Array.from(dropdown.children) as HTMLElement[];
        const optionsCount = options.length;
    
        if (optionsCount === 0) return;
    
        const currentIndex = dropdown === this.patternDropdown ? this.selectedOptionIndex : this.selectedModelIndex;
        const newIndex = (currentIndex + direction + optionsCount) % optionsCount;
    
        options.forEach((option, index) => {
            if (index === newIndex) {
                option.classList.add('selected');
            } else {
                option.classList.remove('selected');
            }
        });
    
        if (dropdown === this.patternDropdown) {
            this.selectedOptionIndex = newIndex;
        } else {
            this.selectedModelIndex = newIndex;
        }
    }

    selectCurrentOption(dropdown: HTMLElement, input: HTMLInputElement) {
        const index = dropdown === this.modelDropdown ? this.selectedModelIndex : this.selectedOptionIndex;
        const selectedOption = dropdown.children[index] as HTMLElement;
        if (selectedOption) {
            const value = selectedOption.textContent!;
            if (dropdown === this.modelDropdown) {
                this.selectModel(value);
            } else {
                input.value = value;
                dropdown.empty();
            }
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
            this.plugin.log('Patterns loaded:', this.patterns);
        } catch (error) {
            this.plugin.log('Failed to load patterns from API:', error);
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
        const model = this.getCurrentModel();
      
        if (!model) {
            new Notice('Please select a model or set a default model in settings before running.');
            return;
        }
        
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
                    model: model,
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
            new Notice('YouTube Fabric output generated successfully');
        } catch (error) {
            console.error('Failed to run YouTube Fabric:', error);
            new Notice('Failed to run YouTube Fabric. Please check your settings and try again.');
        }
    }
    
    async syncCustomPatterns() {
        const customPatternsFolder = this.plugin.settings.customPatternsFolder;
        if (!customPatternsFolder) {
            new Notice('Custom patterns folder not set. Please set it in the plugin settings.');
            return;
        }
    
        const folderPath = this.app.vault.getAbstractFileByPath(customPatternsFolder);
        if (!folderPath || !(folderPath instanceof TFolder)) {
            new Notice('Custom patterns folder not found in the vault.');
            return;
        }
    
        for (const file of folderPath.children) {
            if (file instanceof TFile && file.extension === 'md') {
                const content = await this.app.vault.read(file);
                const patternName = file.basename;
    
                try {
                    await this.updatePattern(patternName, content);
                    new Notice(`Pattern "${patternName}" synced successfully.`);
                } catch (error) {
                    new Notice(`Failed to sync pattern "${patternName}": ${error.message}`);
                }
            }
        }
    }
    
    async updatePattern(name: string, content: string) {
        const response = await fetch(`${apiURL}update_pattern`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                pattern: name,
                content: content
            })
        });
    
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        await this.loadPatterns()

    
        return await response.json();
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
    
      const fabConnectorText = `
This plugin requires that you have fabric and fabric connector installed.

Install Instructions:
1. [danielmiessler/fabric](https://github.com/danielmiessler/fabric)
2. [chasebank87/fabric-connector](https://github.com/chasebank87/fabric-connector)

Follow Daniel's instructions to install fabric and then to run the Fabric Connector, use the latest release
from fabric-connector repository. Windows and MacOS packages are availble.
      `
      const fabConnectorRequried = containerEl.createEl('div', { cls: 'fabConnector-required' });
      MarkdownRenderer.render(this.app, fabConnectorText, fabConnectorRequried, '', this.plugin);

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
      
    new Setting(containerEl)
    .setName('Custom Patterns Folder')
    .setDesc('Path to your custom patterns folder within the vault')
    .addText(text => text
        .setPlaceholder('CustomPatterns')
        .setValue(this.plugin.settings.customPatternsFolder)
        .onChange(async (value) => {
            this.plugin.settings.customPatternsFolder = value;
            await this.plugin.saveSettings();
        }));
      
    new Setting(containerEl)
    .setName('Default Model')
    .setDesc('Set the default model')
    .addText(text => text
        .setPlaceholder('Enter default model')
        .setValue(this.plugin.settings.defaultModel)
        .onChange(async (value) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
            // Update the display in the main view if it's open
            this.app.workspace.getLeavesOfType('fabric-view').forEach((leaf) => {
                if (leaf.view instanceof FabricView) {
                    leaf.view.updateDefaultModelDisplay();
                }
            });
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
      
          new Setting(containerEl)
          .setName('Debug Mode')
          .setDesc('Enable debug logging')
          .addToggle(toggle => toggle
              .setValue(this.plugin.settings.debug)
              .onChange(async (value) => {
                  this.plugin.settings.debug = value;
                  await this.plugin.saveSettings();
                  this.plugin.updateLogging();
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