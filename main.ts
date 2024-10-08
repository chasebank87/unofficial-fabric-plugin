import { App, Platform, Plugin, PluginSettingTab, Setting, WorkspaceLeaf, TFile, TFolder, TAbstractFile, Notice, ItemView, MarkdownRenderer, setIcon, Modal, ViewState, ButtonComponent} from 'obsidian';
import { exec } from 'child_process';
import { promisify } from 'util';
import * as path from 'path';
import * as os from 'os';
import * as fuzzaldrin from 'fuzzaldrin-plus';

const shellEscape = require('shell-escape');
const execAsync = promisify(exec);

interface FabricPluginSettings {
    fabricConnectorApiUrl: string;
    fabricConnectorApiKey: string;
    outputFolder: string;
    customPatternsFolder: string;
    youtubeAutodetectEnabled: boolean;
    audioFileAutodetectEnabled: boolean;
    defaultModel: string;
    defaultPostProcessingPattern: string;
    debug: boolean;
    fabric2: boolean;
    tavilyApiKey: string;
}

const DEFAULT_SETTINGS: FabricPluginSettings = {
    fabricConnectorApiUrl: '',
    fabricConnectorApiKey: '',
    outputFolder: '',
    customPatternsFolder: '',
    youtubeAutodetectEnabled: true,
    audioFileAutodetectEnabled: true,
    defaultModel: 'gpt-4o',
    defaultPostProcessingPattern: '',
    debug: false,
    fabric2: false,
    tavilyApiKey: ''
};

export default class FabricPlugin extends Plugin {
    settings: FabricPluginSettings;
    customPatternsFolder: TFolder | null = null;
    patterns: string[] = [];
    debug: boolean;

    async onload() {
        await this.loadSettings();
        this.updateLogging();
        await this.checkAndDownloadLogo(); 
        await this.loadSettings();
        this.registerCustomPatternsFolderWatcher();

        this.app.workspace.onLayoutReady(() => {
            this.registerCustomPatternsFolderWatcher();
        });

        this.addCommand({
            id: 'open-community-patterns',
            name: 'Open Community Patterns',
            callback: () => {
              new CommunityPatternsModal(this.app, this).open();
            }
        });

        this.addSettingTab(new FabricSettingTab(this.app, this));

        this.registerView(
            'fabric-view',
            (leaf) => new FabricView(
                leaf,
                this,
                this.settings.fabricConnectorApiUrl,
                this.settings.fabricConnectorApiKey
            )
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

    async checkAndDownloadLogo() {
        if (!this.manifest.dir) {
            console.error('Plugin directory is undefined');
            return;
        }
    
        const logoPath = path.join(this.manifest.dir, 'fabric-logo-gif.gif');
        const logoExists = await this.app.vault.adapter.exists(logoPath);
    
        if (!logoExists) {
            try {
                const logoUrl = 'https://raw.githubusercontent.com/chasebank87/unofficial-fabric-plugin/main/fabric-logo-gif.gif';
                const response = await fetch(logoUrl);
                if (!response.ok) throw new Error('Failed to fetch logo');
                const arrayBuffer = await response.arrayBuffer();
                const buffer = new Uint8Array(arrayBuffer);
                await this.app.vault.adapter.writeBinary(logoPath, buffer);
                this.log('Fabric logo downloaded successfully');
            } catch (error) {
                console.error('Error downloading Fabric logo:', error);
            }
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
        const response = await fetch(this.settings.fabricConnectorApiUrl + '/delete_pattern', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.settings.fabricConnectorApiKey // Add the Fabric Connector API Key here
            },
            body: JSON.stringify({ pattern: patternName })
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

    async getDefaultShell(): Promise<string> {
        // Use Platform.isWin instead of os.platform() to detect Windows
        if (Platform.isWin) {
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
    communityPatternsBtn: HTMLElement;
    logoContainer: HTMLElement;
    loadingText: HTMLElement;
    ytSwitch: HTMLInputElement;
    ytToggle: HTMLElement;
    tsToggle: HTMLElement;
    modelSearchInput: HTMLInputElement;
    modelDropdown: HTMLElement;
    models: string[] = [];
    selectedModelIndex: number = -1;
    defaultModelDisplay: HTMLElement;
    modelNameSpan: HTMLSpanElement;
    syncButton: HTMLElement;
    fabricConnectorApiUrl: string;
    fabricConnectorApiKey: string;
    selectedPatterns: string[] = [];

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

    constructor(leaf: WorkspaceLeaf, plugin: FabricPlugin, fabricConnectorApiUrl: string, fabricConnectorApiKey: string) {
        super(leaf);
        this.plugin = plugin;
        this.fabricConnectorApiUrl = fabricConnectorApiUrl;
        this.fabricConnectorApiKey = fabricConnectorApiKey;
    }

    getViewType(): string {
        return 'fabric-view';
    }

    getDisplayText(): string {
        return 'Fabric';
    }

    showCommunityPatternsModal() {
        new CommunityPatternsModal(this.app, this.plugin).open();
      }

    async onOpen() {
        this.containerEl = this.contentEl;
        this.containerEl.empty();
        this.containerEl.addClass('fabric-view');


        this.logoContainer = this.containerEl.createEl('div', { cls: 'fabric-logo-container' });
        let logoPath: string;
        if (this.plugin.manifest && this.plugin.manifest.dir) {
            logoPath = path.join(this.plugin.manifest.dir, 'fabric-logo-gif.gif');
            const logoSrc = this.app.vault.adapter.getResourcePath(logoPath);
        } else {
            // Fallback to the GitHub URL if the plugin directory is undefined
            logoPath = 'https://raw.githubusercontent.com/chasebank87/unofficial-fabric-plugin/main/fabric-logo-gif.gif';
        }

        const logoSrc = this.app.vault.adapter.getResourcePath(logoPath);
        const logo = this.logoContainer.createEl('img', {
            cls: 'fabric-logo',
            attr: { src: logoSrc }
        });
        this.loadingText = this.logoContainer.createEl('h6', { cls: 'fabric-loading-text' });

        const contentContainer = this.containerEl.createEl('div', { cls: 'fabric-content' });

    // Add YouTube toggle and icon
    const ytToggleContainer = contentContainer.createEl('div', { cls: 'fabric-yt-toggle-container' });
        
    // Add YouTube toggle and icon
    const tsToggleContainer = contentContainer.createEl('div', { cls: 'fabric-ts-toggle-container' });
        
    // Create toggle for yt
    this.ytToggle = ytToggleContainer.createEl('div', { 
        cls: `fabric-yt-toggle ${this.plugin.settings.youtubeAutodetectEnabled ? 'active' : ''}`
    });
    const toggleSlider = this.ytToggle.createEl('span', { cls: 'fabric-yt-toggle-slider' });
    
        // Create text label
        const ytLabel = ytToggleContainer.createEl('span', { 
            cls: 'fabric-yt-label',
            text: 'YouTube Links'
        });
    
    // Create toggle for ts
    this.tsToggle = tsToggleContainer.createEl('div', { 
        cls: `fabric-ts-toggle ${this.plugin.settings.audioFileAutodetectEnabled ? 'active' : ''}`
    });
    const toggleSliderTS = this.tsToggle.createEl('span', { cls: 'fabric-ts-toggle-slider' });
    
    // Create text label
    const tsLabel = tsToggleContainer.createEl('span', { 
        cls: 'fabric-ts-label',
        text: 'Audio Files'
    });


      contentContainer.createEl('h3', { text: 'fabric', cls: 'fabric-title' });

      this.buttonsContainer = contentContainer.createEl('div', { cls: 'fabric-buttons' });
      const currentNoteBtn = this.buttonsContainer.createEl('button', { text: 'Current note', cls: 'fabric-button current-note' });
      const clipboardBtn = this.buttonsContainer.createEl('button', { text: 'Clipboard', cls: 'fabric-button clipboard' });

      const tavilyBtn = this.buttonsContainer.createEl('button', { text: 'Tavily', cls: 'fabric-button tavily' });
      
        tavilyBtn.onclick = () => this.showTavilySearchModal();
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
  
      this.patternDropdown = contentContainer.createEl('div', { cls: 'fabric-dropdown' , attr: { id: 'pattern-dropdown', multiple: 'true' }} );
      this.modelDropdown = contentContainer.createEl('div', { cls: 'fabric-dropdown', attr: { id: 'model-dropdown' }});
  
      this.searchInput.addEventListener('blur', () => {
        // Use setTimeout to allow click events on dropdown options to fire first
        setTimeout(() => {
            this.patternDropdown.empty();
            this.selectedOptionIndex = -1;
        }, 200);
      });
        
      this.searchInput.addEventListener('input', () => {
        const inputValue = this.searchInput.value;
        const patterns = inputValue.split(',').map(p => p.trim()).filter(p => p !== '');
        
        // The last item might be a partial search term, so we exclude it from selected patterns
        const selectedPatterns = patterns.slice(0, -1);
        const searchTerm = patterns[patterns.length - 1] || '';
    
        // Update selectedPatterns, ensuring no more than 5 are selected
        this.selectedPatterns = selectedPatterns.slice(0, 5);
    
        // Update the dropdown options based on the search term
        this.updatePatternOptions(searchTerm.toLowerCase());
    });
  
      this.modelSearchInput.addEventListener('input', () => {
          this.updateModelOptions(this.modelSearchInput.value.toLowerCase());
          this.updatePoweredByText(this.modelSearchInput.value);
      });
  
      this.searchInput.addEventListener('keydown', (event) => {
        this.handlePatternDropdownNavigation(event, this.patternDropdown, this.searchInput);
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
        
      this.tsToggle.addEventListener('click', () => {
        this.tsToggle.classList.toggle('active');
        this.plugin.settings.audioFileAutodetectEnabled = this.tsToggle.classList.contains('active');
        this.plugin.saveSettings();
        if (this.plugin.settings.audioFileAutodetectEnabled) {
            new Notice('Audio file detection enabled');
        } else {
            new Notice('Audio file link detection disabled');
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
        
    this.communityPatternsBtn = contentContainer.createEl('button', {
        cls: 'fabric-icon-button  community-patterns',
        attr: {
            'aria-label': 'Download community patterns'
        }
    });
        setIcon(this.communityPatternsBtn, 'download');
        
      this.communityPatternsBtn.onclick = () => this.showCommunityPatternsModal();
  


    this.progressSpinner = contentContainer.createEl('div', { cls: 'fabric-progress-spinner' });
    

        await this.loadPatterns();
        await this.loadModels();
        this.updatePatternOptions('');
        this.updateModelOptions('');
        this.searchInput.focus();
    }
    
    showTavilySearchModal() {
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
        
        const modal = new Modal(this.app);
        modal.titleEl.setText('Tavily Search');
        const { contentEl } = modal;
        contentEl.addClass('fabric-tavily-modal');
        const searchInput = contentEl.createEl('input', {
            type: 'text',
            placeholder: 'Enter your search query'
        });
        searchInput.addClass('fabric-tavily-input');
    
        const searchButton = contentEl.createEl('button', {
            text: 'Search',
            cls: 'mod-cta'
        });

        searchButton.addClass('fabric-tavily-search-button');
    
        searchButton.onclick = async () => {
            const query = searchInput.value.trim();
            if (query) {
                modal.close();
                await this.performTavilySearch(query);
            } else {
                new Notice('Please enter a search query');
            }
        };
    
        modal.open();
    }

    async performTavilySearch(query: string) {
        this.logoContainer.addClass('loading');
        this.loadingText.setText('');
        this.animateLoadingText('Searching Tavily...');
    
        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: query,
                    include_answer: true,
                    max_results: 5,
                    include_images: true,
                    search_depth: "basic",
                    api_key: this.plugin.settings.tavilyApiKey
                })
            });
    
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
    
            const data = await response.json();
            const searchResult = JSON.stringify(data) + '\n';
            await this.runFabricWithTavilyResult(searchResult);
        } catch (error) {
            console.error('Failed to perform Tavily search:', error);
            new Notice('Failed to perform Tavily search. Please check your API key and try again.');
        } finally {
            this.logoContainer.removeClass('loading');
            this.loadingText.setText('');
        }
    }
    
    async runFabricWithTavilyResult(searchResult: string) {
        if (this.plugin.settings.defaultPostProcessingPattern) {
            this.selectedPatterns.push(this.plugin.settings.defaultPostProcessingPattern);
        }
        const pattern = this.selectedPatterns;
        const model = this.getCurrentModel();
        let outputNoteName = this.outputNoteInput.value.trim();
    
        if (!model) {
            new Notice('Please select a model or set a default model in settings before running.');
            return;
        }
    
        if (!pattern) {
            new Notice('Please select a pattern first');
            return;
        }
    
        try {
            const response = await fetch(this.plugin.settings.fabricConnectorApiUrl + '/fabric', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json',
                    'X-API-Key': this.plugin.settings.fabricConnectorApiKey
                },
                body: JSON.stringify({
                    pattern: pattern,
                    model: model,
                    data: searchResult,
                    stream: true,
                    goCompatibility: this.plugin.settings.fabric2
                })
            });
    
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
    
            const responseData = await response.json();
            const output = responseData.output;
    
            const newFile = await this.createOutputNote(output, outputNoteName);
            new Notice('Fabric output generated successfully with Tavily search result');
        } catch (error) {
            console.error('Failed to run fabric with Tavily result:', error);
            new Notice('Failed to run fabric with Tavily result. Please check your settings and try again.');
        }
    }

  async runFabric(source: 'current' | 'clipboard' | 'pattern') {
    let data = '';
    let pattern = this.selectedPatterns;
    let outputNoteName = this.outputNoteInput.value.trim();
    const model = this.getCurrentModel();
      
    if (!model) {
        new Notice('Please select a model or set a default model in settings before running.');
        return;
    }
    
    if (source === 'current') {
        const activeFile = this.app.workspace.getActiveFile();
        if (activeFile) {
            data = await this.app.vault.read(activeFile) + '\n';
        }
    } else if (source === 'clipboard') {
        data = await navigator.clipboard.readText() + '\n';
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
        const response = await fetch(this.plugin.settings.fabricConnectorApiUrl + '/fabric', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Accept': 'application/json',
                'X-API-Key': this.plugin.settings.fabricConnectorApiKey
            },
            body: JSON.stringify({
                pattern: pattern,
                model: model,
                data: data,
                stream: true,
                goCompatibility: this.plugin.settings.fabric2
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
    
        const filteredPatterns = query 
            ? fuzzaldrin.filter(this.patterns, query)
            : this.patterns;
    
        if (filteredPatterns.length === 0) {
            this.patternDropdown.createEl('div', {
                cls: 'fabric-dropdown-option',
                text: 'No patterns found'
            });
        } else {
            filteredPatterns.forEach((pattern, index) => {
                this.addPatternOption(pattern, index);
            });
        }
    
        if (this.patternDropdown.children.length > 0) {
            this.selectedOptionIndex = 0;
            this.updateSelectedOption(this.patternDropdown.querySelectorAll('.fabric-dropdown-option'));
        }
    }


    private addPatternOption(pattern: string, index: number) {
        const option = this.patternDropdown.createEl('div', {
            cls: `fabric-dropdown-option ${index === 0 ? 'selected' : ''}`,
            text: pattern
        });
        
        option.addEventListener('mousedown', (event) => {
            // Prevent the default behavior which would trigger the blur event
            event.preventDefault();
        });
    
        option.addEventListener('click', (event) => {
            event.preventDefault();
            this.selectPattern(pattern);
            // Refocus on the input after selection
            this.searchInput.focus();
        });
    }

    private selectPattern(pattern: string) {
        if (this.selectedPatterns.length >= 5 && !this.selectedPatterns.includes(pattern)) {
            new Notice('You can only select up to 5 patterns.');
            return;
        }
    
        if (!this.selectedPatterns.includes(pattern)) {
            this.selectedPatterns.push(pattern);
        }
    
        this.searchInput.value = this.selectedPatterns.join(', ') + (this.selectedPatterns.length > 0 ? ', ' : '');
        this.updatePatternOptions('');
        this.searchInput.focus();
    
        // Set cursor position to the end
        const len = this.searchInput.value.length;
        this.searchInput.setSelectionRange(len, len);
    }

    private updateSelectedOption(options: NodeListOf<Element>) {
        options.forEach((option, index) => {
            if (index === this.selectedOptionIndex) {
                option.classList.add('selected');
                option.scrollIntoView({ block: 'nearest' });
            } else {
                option.classList.remove('selected');
            }
        });
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
        const url = new URL(this.plugin.settings.fabricConnectorApiUrl + '/models');
        url.searchParams.append('goCompatibility', this.plugin.settings.fabric2.toString());
        const response = await fetch(url, {
            method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.plugin.settings.fabricConnectorApiKey
            }
        });
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
    
handlePatternDropdownNavigation(event: KeyboardEvent, dropdown: HTMLElement, input: HTMLInputElement) {
    const options = dropdown.querySelectorAll('.fabric-dropdown-option');

    switch (event.key) {
        case 'ArrowDown':
            event.preventDefault();
            this.selectedOptionIndex = Math.min(this.selectedOptionIndex + 1, options.length - 1);
            this.updateSelectedOption(options);
            break;
        case 'ArrowUp':
            event.preventDefault();
            this.selectedOptionIndex = Math.max(this.selectedOptionIndex - 1, 0);
            this.updateSelectedOption(options);
            break;
        case 'Enter':
            event.preventDefault();
            if (this.selectedOptionIndex >= 0 && this.selectedOptionIndex < options.length) {
                const selectedPattern = options[this.selectedOptionIndex].textContent;
                if (selectedPattern) {
                    this.selectPattern(selectedPattern);
                    // Keep the dropdown open
                    this.updatePatternOptions('');
                }
            }
            break;
        case 'Escape':
            event.preventDefault();
            dropdown.empty();
            this.selectedOptionIndex = -1;
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
            const url = new URL(this.plugin.settings.fabricConnectorApiUrl + '/patterns');
        url.searchParams.append('goCompatibility', this.plugin.settings.fabric2.toString());
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.plugin.settings.fabricConnectorApiKey
                },
            });
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
        if (this.plugin.settings.defaultPostProcessingPattern) {
            this.selectedPatterns.push(this.plugin.settings.defaultPostProcessingPattern);
        }
        if (this.ytToggle.classList.contains('active') && this.tsToggle.classList.contains('active')) {
            const links = await this.extractYouTubeLinks(source);
            const paths = await this.extractAudioFiles(source);
            if (links.length > 0 && paths.length > 0) {
                new Notice('Both YouTube links and audio files found. This is not supported yet. Try using clipboard.');
                this.runFabric(source);
                return;
            }
            if (links.length > 0) {
                this.showYouTubeModal(links, source);
            } else if (paths.length > 0) {
                this.showAudioModal(paths, source);
            } else {
                new Notice('No YouTube links or audio files found. Running Fabric normally.');
            this.runFabric(source);
            }
        } else if (this.tsToggle.classList.contains('active')) {
            const links = await this.extractAudioFiles(source);
            if (links.length > 0) {
                this.showAudioModal(links, source);
            } else {
                new Notice('No audio files found. Running Fabric normally.');
                this.runFabric(source);
            }
        } else if (this.ytToggle.classList.contains('active')) {
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

    async extractAudioFiles(source: 'current' | 'clipboard'): Promise<string[]> {
        let text = '';
        if (source === 'current') {
            const activeFile = this.app.workspace.getActiveFile();
            if (activeFile) {
                text = await this.app.vault.read(activeFile);
            }
        } else {
            text = await navigator.clipboard.readText();
        }
        const audioRegex = /(?:^|[\s(])?(?:")?(?:\/|[a-zA-Z]:[\\/])(?:[^"\n\r]*[\\/])*[^"\n\r]*\.(?:mp3|wav|ogg|aac|flac|mp4|mkv|webm|avi|mov|flv)(?:")?(?:\s|$)/gi;
        return text.match(audioRegex) || [];
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

    showAudioModal(files: string[], source: 'current' | 'clipboard') {
        const modal = new Modal(this.app);
        modal.titleEl.setText('Select Audio File Path');
        const { contentEl } = modal;
    
        let selectedIndex = 0;
    
        const fileList = contentEl.createEl('div', { cls: 'fabric-ts-link-list' });
    
        const updateSelection = () => {
            fileList.querySelectorAll('.fabric-ts-link').forEach((el, index) => {
                el.classList.toggle('is-selected', index === selectedIndex);
            });
        };
    
        files.forEach((file, index) => {
            const linkEl = fileList.createEl('div', { cls: 'fabric-ts-link', text: file });
            linkEl.addEventListener('click', () => {
                selectedIndex = index;
                updateSelection();
            });
        });
    
        const buttonContainer = contentEl.createEl('div', { cls: 'fabric-ts-modal-buttons' });
        const skipButton = buttonContainer.createEl('button', { text: 'Skip' });
        skipButton.addClass('skip-button');
        const runTSButton = buttonContainer.createEl('button', { text: 'Run' });
        runTSButton.addClass('run-button');

        skipButton.addEventListener('click', () => {
            modal.close();
            this.runTS(source);
        });
    
        runTSButton.addEventListener('click', () => {
            modal.close();
            if (files.length > 0) {
                this.runTS(files[selectedIndex]);
            } else {
                new Notice('No audio files found');
            }
        });
    
        modal.onOpen = () => {
            updateSelection();
            
            const handleKeyDown = (event: KeyboardEvent) => {
                switch (event.key) {
                    case 'ArrowUp':
                        selectedIndex = (selectedIndex - 1 + files.length) % files.length;
                        updateSelection();
                        event.preventDefault();
                        break;
                    case 'ArrowDown':
                        selectedIndex = (selectedIndex + 1) % files.length;
                        updateSelection();
                        event.preventDefault();
                        break;
                    case 'Enter':
                        modal.close();
                        this.runTS(files[selectedIndex]);
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
        const pattern = this.selectedPatterns
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
            const response = await fetch(this.plugin.settings.fabricConnectorApiUrl + '/yt', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.plugin.settings.fabricConnectorApiKey
                },
                body: JSON.stringify({
                    pattern: pattern,
                    model: model,
                    url: url,
                    stream: true,
                    goCompatibility: this.plugin.settings.fabric2
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

    async runTS(path: string) {
        let outputNoteName = this.outputNoteInput.value.trim();
        const pattern = this.selectedPatterns
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
            const response = await fetch(this.plugin.settings.fabricConnectorApiUrl + '/ts', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': this.plugin.settings.fabricConnectorApiKey
                },
                body: JSON.stringify({
                    pattern: pattern,
                    model: model,
                    path: path,
                    stream: true,
                    goCompatibility: this.plugin.settings.fabric2
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
            new Notice('TS Fabric output generated successfully');
        } catch (error) {
            console.error('Failed to run TS Fabric:', error);
            new Notice('Failed to run TS Fabric. Please check your settings and try again.');
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
        await this.loadPatterns()
    }
    
    async updatePattern(name: string, content: string) {
        const response = await fetch(this.plugin.settings.fabricConnectorApiUrl + '/update_pattern', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': this.plugin.settings.fabricConnectorApiKey
            },
            body: JSON.stringify({
                pattern: name,
                content: content
            })
        });
    
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }

        

    
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

        // Instructions for Fabric Connector API URL and Key
        containerEl.createEl('p', {
            text: 'To set up the Fabric Connector:',
            cls: 'fabric-settings-instruction'
        });
        containerEl.createEl('ol', {cls: 'fabric-settings-list'}, (ol) => {
            ol.createEl('li', {text: 'Click the Fabric Connector icon (brain icon) in your system tray'});
            ol.createEl('li', {text: 'For the API URL: Click "Open API Docs" and copy the URL from your browser, removing "/docs" from the end'});
            ol.createEl('li', {text: 'For the API Key: Click "Copy API Key"'});
        });

        // Fabric Connector API URL input
        new Setting(containerEl)
            .setName('Fabric Connector API URL')
            .setDesc('Enter the URL for the Fabric Connector API')
            .addDropdown(dropdown => {
                dropdown
                    .addOption('http://', 'http://')
                    .addOption('https://', 'https://')
                    .setValue(this.plugin.settings.fabricConnectorApiUrl.startsWith('https://') ? 'https://' : 'http://')
                    .onChange(async (value) => {
                        const domain = this.plugin.settings.fabricConnectorApiUrl.replace(/^https?:\/\//, '');
                        this.plugin.settings.fabricConnectorApiUrl = value + domain;
                        await this.plugin.saveSettings();
                    });
            })
            .addText(text => {
                const domain = this.plugin.settings.fabricConnectorApiUrl.replace(/^https?:\/\//, '');
                text
                    .setPlaceholder('Enter domain')
                    .setValue(domain)
                    .onChange(async (value) => {
                        // Remove any slashes from the input
                        const cleanValue = value.replace(/\//g, '');
                        const protocol = this.plugin.settings.fabricConnectorApiUrl.startsWith('https://') ? 'https://' : 'http://';
                        this.plugin.settings.fabricConnectorApiUrl = protocol + cleanValue;
                        await this.plugin.saveSettings();
                        // Update the text field to show the cleaned value
                        text.setValue(cleanValue);
                    });
            });

        // Fabric Connector API Key input
        new Setting(containerEl)
            .setName('Fabric Connector API Key')
            .setDesc('Enter your API key for the Fabric Connector')
            .addText(text => text
                .setPlaceholder('Enter API Key')
                .setValue(this.plugin.settings.fabricConnectorApiKey || '')
                .onChange(async (value) => {
                    this.plugin.settings.fabricConnectorApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Test API Key')
                .onClick(async () => {
                    await this.testFabricConnectorApiKey();
                }));


        new Setting(containerEl)
            .setName('Tavily API Key')
            .setDesc('Enter your Tavily API key')
            .addText(text => text
                .setPlaceholder('Enter API Key')
                .setValue(this.plugin.settings.tavilyApiKey || '')
                .onChange(async (value) => {
                    this.plugin.settings.tavilyApiKey = value;
                    await this.plugin.saveSettings();
                }))
            .addButton(button => button
                .setButtonText('Test API Key')
                .onClick(async () => {
                    await this.testTavilyApiKey();
                }));

        new Setting(containerEl)
            .setName('Output Folder')
            .setDesc('Folder to save output files')
            .addText(text => text
                .setPlaceholder('Enter folder path')
                .setValue(this.plugin.settings.outputFolder)
                .onChange(async (value) => {
                    this.plugin.settings.outputFolder = value;
                    await this.plugin.saveSettings();
                }));

        new Setting(containerEl)
            .setName('Custom Patterns Folder')
            .setDesc('Folder to store custom patterns')
            .addText(text => text
                .setPlaceholder('Enter folder path')
                .setValue(this.plugin.settings.customPatternsFolder)
                .onChange(async (value) => {
                    this.plugin.settings.customPatternsFolder = value;
                    await this.plugin.saveSettings();
                    this.plugin.registerCustomPatternsFolderWatcher();
                }));
        
        new Setting(containerEl)
        .setName('Default Model')
        .setDesc('The default model to use when running Fabric')
        .addText(text => text
            .setPlaceholder('Enter default model')
            .setValue(this.plugin.settings.defaultModel)
            .onChange(async (value) => {
            this.plugin.settings.defaultModel = value;
            await this.plugin.saveSettings();
            }));
        
        new Setting(containerEl)
        .setName('Default Post Processing Pattern')
        .setDesc('This pattern will be appended to selected patterns when running Fabric')
        .addText(text => text
            .setPlaceholder('Enter pattern name')
            .setValue(this.plugin.settings.defaultPostProcessingPattern)
            .onChange(async (value) => {
                this.plugin.settings.defaultPostProcessingPattern = value;
                await this.plugin.saveSettings();
            }));
        
        new Setting(containerEl)
        .setName('Fabric 2.0 Compatibility Mode')
        .setDesc('Enable comptaibility mode for Fabric 2.0')
        .addToggle(toggle => toggle
            .setValue(this.plugin.settings.fabric2)
            .onChange(async (value) => {
                this.plugin.settings.fabric2 = value;
                await this.plugin.saveSettings();
                this.plugin.updateLogging();
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

    async testFabricConnectorApiKey() {
        const fabricConnectorApiUrl = this.plugin.settings.fabricConnectorApiUrl;
        const url = new URL(this.plugin.settings.fabricConnectorApiUrl + '/models');
        url.searchParams.append('goCompatibility', this.plugin.settings.fabric2.toString());
        const apiKey = this.plugin.settings.fabricConnectorApiKey;

        if (!fabricConnectorApiUrl || !apiKey) {
            new Notice('Please enter both Fabric Connector API URL and API Key');
            return;
        }

        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Content-Type': 'application/json',
                    'X-API-Key': apiKey
                }
            });

            if (response.ok) {
                new Notice('Fabric Connector API Key is valid');
            } else {
                new Notice('Invalid Fabric Connector API Key');
            }
        } catch (error) {
            console.error('Error testing Fabric Connector API Key:', error);
            new Notice('Error testing Fabric Connector API Key. Check console for details.');
        }

    }

    async testTavilyApiKey() {
        const apiKey = this.plugin.settings.tavilyApiKey;

        if (!this.plugin.settings.tavilyApiKey) {
            new Notice('Please enter a Tavily API Key');
            return;
        }

        try {
            const response = await fetch('https://api.tavily.com/search', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    query: 'Test Query',
                    max_results: 1,
                    api_key: apiKey
                })
            });

            if (response.ok) {
                new Notice('Tavily API Key is valid');
            } else {
                new Notice('Invalid Tavily API Key');
            }
        } catch (error) {
            console.error('Error testing Tavily API Key:', error);
            new Notice('Error testing Tavily API Key. Check console for details.');
        }
    }
}


class CommunityPatternsModal extends Modal {
  plugin: FabricPlugin;
  patterns: any[];
  searchInput: HTMLInputElement;
  resultsContainer: HTMLElement;

  constructor(app: App, plugin: FabricPlugin) {
    super(app);
    this.plugin = plugin;
  }

  async onOpen() {
    const { contentEl } = this;
    contentEl.empty();

    contentEl.createEl('h2', { text: 'Community Patterns', cls: 'community-patterns-title' });

      // Add Update All button
      
      const buttonContainer = contentEl.createDiv({ cls: 'community-patterns-button-container' });

      const updateAllButton = new ButtonComponent(buttonContainer)
      .setButtonText('Update All')
      .onClick(() => this.updateAllPatterns());
    //setIcon(updateAllButton.buttonEl, 'refresh-cw'); // Use an appropriate icon
      updateAllButton.buttonEl.className = 'fabric-button community-patterns-update-all';
      
      const refreshPatternsButton = new ButtonComponent(buttonContainer)
      .setButtonText('Refresh Patterns')
      .onClick(() => this.refreshPatterns());
    //setIcon(refreshPatternsButton.buttonEl, 'refresh-cw'); // Use an appropriate icon
    refreshPatternsButton.buttonEl.className = 'fabric-button community-patterns-refresh';


    this.searchInput = contentEl.createEl('input', {
      type: 'text',
      placeholder: 'Search patterns...',
      cls: 'community-patterns-search'
    });
    this.searchInput.addEventListener('input', () => this.updateResults());

    this.resultsContainer = contentEl.createEl('div', { cls: 'community-patterns-results' });

    await this.fetchPatterns();
    this.updateResults();
  }

  async fetchPatterns() {
    try {
      const response = await fetch('https://raw.githubusercontent.com/chasebank87/fabric-patterns/main/patterns.json');
      if (!response.ok) {
        throw new Error('Failed to fetch patterns');
      }
      const data = await response.json();
      this.patterns = Object.keys(data.patterns).map(key => ({
        name: key,
        ...data.patterns[key]
      }));
    } catch (error) {
      console.error('Error fetching patterns:', error);
      new Notice('Failed to fetch patterns');
    }
  }

  async isPatternInstalled(patternName: string): Promise<boolean> {
    const file = `${this.plugin.settings.customPatternsFolder}/${patternName}.md`;
    return await this.app.vault.adapter.exists(file);
  }

  async doesPatternNeedUpdate(patternName: string, pattern_repo: string): Promise<boolean> {
    const installedPath = `${this.plugin.settings.customPatternsFolder}/${patternName}.md`;
    const repoPath = 'https://raw.githubusercontent.com/'+ pattern_repo + '/main/patterns/' + patternName + '.md';

      const installedContent = await this.app.vault.adapter.read(installedPath); 
    const response = await fetch(repoPath);
    if (!response.ok) {
      throw new Error('Failed to fetch pattern content');
    }
    const repoContent = await response.text();

    return installedContent !== repoContent;
  }

  async updateResults() {
    const searchTerm = this.searchInput.value.toLowerCase();
    const filteredPatterns = this.patterns.filter(pattern =>
      pattern.name.toLowerCase().includes(searchTerm) ||
      pattern.description.toLowerCase().includes(searchTerm) ||
      pattern.author.toLowerCase().includes(searchTerm)
    );

    this.resultsContainer.empty(); 
    for (const pattern of filteredPatterns) {
        try {
            // Check if the pattern_repo URL is valid
        let currentPatternUrl = 'https://raw.githubusercontent.com/'+ pattern.pattern_repo + '/main/patterns/' + pattern.name + '.md';
        const response = await fetch(currentPatternUrl);
        if (!response.ok) {
            console.warn(`Pattern ${pattern.name} has an invalid URL: ${currentPatternUrl}`);
            continue; // Skip this pattern and move to the next one
        }

        const patternEl = this.resultsContainer.createEl('div', { cls: 'community-pattern-item' });

        const patternInfo = patternEl.createEl('div', { cls: 'community-pattern-info' });
        patternInfo.createEl('div', { text: pattern.name, cls: 'community-pattern-title' });
            patternInfo.createEl('div', { text: pattern.description, cls: 'community-pattern-description' });
            patternInfo.createEl('em', {text: `by ${pattern.author}`, cls: 'community-fabric-author'});
            patternInfo.createEl('small', { text: `For models: ${pattern.for_models}`, cls: 'community-fabric-models' });
    

        const isInstalled = await this.isPatternInstalled(pattern.name);
        const needsUpdate = isInstalled && await this.doesPatternNeedUpdate(pattern.name, pattern.pattern_repo);

        const buttonContainer = patternEl.createEl('div', { cls: 'community-pattern-buttons' });

        if (!isInstalled) {
            const downloadBtn = new ButtonComponent(buttonContainer)
            .setButtonText('')
            .onClick(() => this.downloadPattern(pattern.name, pattern.pattern_repo));
            downloadBtn.buttonEl.className = 'community-pattern-download';
            setIcon(downloadBtn.buttonEl, 'download');
        } else {
            if (needsUpdate) {
            const updateBtn = new ButtonComponent(buttonContainer)
                .setButtonText('')
                .onClick(() => this.updatePattern(pattern.name, pattern.pattern_repo));
            updateBtn.buttonEl.className = 'community-pattern-update';
            setIcon(updateBtn.buttonEl, 'refresh-cw');
            }
            const uninstallBtn = new ButtonComponent(buttonContainer)
            .setButtonText('')
            .onClick(() => this.uninstallPattern(pattern.name));
            uninstallBtn.buttonEl.className = 'community-pattern-uninstall';
            setIcon(uninstallBtn.buttonEl, 'trash');
        }
        } catch (error) {
        console.error(`Error processing pattern ${pattern.name}:`, error);
        // Skip this pattern and move to the next one
        }
    }
    }
    
  async downloadPattern(patternName: string, pattern_repo: string) {
      try {
          let patternUrl = 'https://raw.githubusercontent.com/'+ pattern_repo + '/main/patterns/' + patternName + '.md';
            console.log(patternUrl);
        const response = await fetch(patternUrl);
      if (!response.ok) {
        throw new Error('Failed to download pattern');
      }
      const content = await response.text();

      const file = `${this.plugin.settings.customPatternsFolder}/${patternName}.md`;
      await this.app.vault.create(file, content);

      new Notice(`Pattern ${patternName} downloaded successfully`);
      this.updateResults();
    } catch (error) {
      console.error('Error downloading pattern:', error);
      new Notice('Failed to download pattern');
    }
  }

  async updatePattern(patternName: string, pattern_repo: string) {
      try {
        let patternUrl = 'https://raw.githubusercontent.com/'+ pattern_repo + '/main/patterns/' + patternName + '.md';
        const response = await fetch(patternUrl);
      if (!response.ok) {
        throw new Error('Failed to update pattern');
      }
      const content = await response.text();

      const file = `${this.plugin.settings.customPatternsFolder}/${patternName}.md`;
      await this.app.vault.adapter.write(file, content);

      new Notice(`Pattern ${patternName} updated successfully`);
      this.updateResults();
    } catch (error) {
      console.error('Error updating pattern:', error);
      new Notice('Failed to update pattern');
    }
  }
    
  async refreshPatterns() {
    await this.fetchPatterns();
    this.updateResults();
    new Notice('Patterns list refreshed');
  }


  async uninstallPattern(patternName: string) {
    try {
      const file = `${this.plugin.settings.customPatternsFolder}/${patternName}.md`;
      await this.app.vault.adapter.remove(file);
      new Notice(`Pattern ${patternName} uninstalled successfully`);
      this.updateResults();
    } catch (error) {
      console.error('Error uninstalling pattern:', error);
      new Notice('Failed to uninstall pattern');
    }
  }

  async updateAllPatterns() {
    let updatedCount = 0;
    for (const pattern of this.patterns) {
      const isInstalled = await this.isPatternInstalled(pattern.name);
      const needsUpdate = isInstalled && await this.doesPatternNeedUpdate(pattern.name, pattern.pattern_repo);
      if (needsUpdate) {
        await this.updatePattern(pattern.name, pattern.pattern_repo);
        updatedCount++;
      }
    }
    new Notice(`Updated ${updatedCount} patterns`);
    this.updateResults();
  }

  onClose() {
    const { contentEl } = this;
    contentEl.empty();
  }
}