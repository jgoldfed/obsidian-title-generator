import {
  App,
  Editor,
  Notice,
  Plugin,
  PluginSettingTab,
  Setting,
  TFile,
  normalizePath,
} from 'obsidian';
import OpenAI from 'openai';
import pMap from 'p-map';
import path from 'path-browserify';

function sanitizeFileName(fileName: string): string {
  return fileName
    .replace(/[\\/:*?"<>|]/g, '_') // Replace truly invalid characters with underscores
    .replace(/^\.+/, '') // Remove leading dots
    .replace(/\.+$/, '') // Remove trailing dots
    .trim(); // Trim leading and trailing spaces
}
interface TitleGeneratorSettings {
  openAiApiKey: string;
  lowerCaseTitles: boolean;
}

const DEFAULT_SETTINGS: TitleGeneratorSettings = {
  openAiApiKey: '',
  lowerCaseTitles: false,
};

class TitleGeneratorSettingTab extends PluginSettingTab {
  plugin: TitleGeneratorPlugin;

  constructor(app: App, plugin: TitleGeneratorPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    new Setting(containerEl).setName('OpenAI API key').addText((text) => {
      text.inputEl.type = 'password';
      text.inputEl.style.width = '100%';

      text
        .setPlaceholder('API Key')
        .setValue(this.plugin.settings.openAiApiKey)
        .onChange(async (newValue) => {
          this.plugin.settings.openAiApiKey = newValue;
          await this.plugin.saveSettings();
        });
    });

    new Setting(containerEl)
      .setName('Lower-case titles')
      .addToggle((toggle) => {
        toggle
          .setValue(this.plugin.settings.lowerCaseTitles)
          .onChange(async (newValue) => {
            this.plugin.settings.lowerCaseTitles = newValue;
            await this.plugin.saveSettings();
          });
      });
  }
}

export default class TitleGeneratorPlugin extends Plugin {
  settings: TitleGeneratorSettings;

  openai: OpenAI;

  private async generateTitle(file: TFile, content: string) {
    const loadingStatus = this.addStatusBarItem();
    loadingStatus.createEl('span', { text: 'Generating title...' });

    try {
      const response = await this.openai.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          {
            role: 'system',
            content:
              'You are a helpful assistant that generates succinct, descriptive titles for given text content. The title should be suitable for use as a file name, and can include spaces, commas, and other common punctuation.',
          },
          {
            role: 'user',
            content: `Given the following text, please generate a succinct, descriptive title that can be used as a file name (avoid characters that Obsidian will not support like \\ / : * ? " < > |):\n\n${content}`,
          },
        ],
        max_tokens: 50,
      });

      let title = response.choices?.[0]?.message?.content?.trim() || '';

      // Remove quotes if present
      title = title.replace(/^["']|["']$/g, '');

      if (this.settings.lowerCaseTitles) {
        title = title.toLowerCase();
      }

      // Sanitize the title for use as a file name
      title = sanitizeFileName(title);

      // Ensure the title is not empty after sanitization

      if (!title) {
        title = 'untitled';
      }

      const currentPath = path.parse(file.path);
      const newPath = normalizePath(
        `${currentPath.dir}/${title}${currentPath.ext}`
      );

      await this.app.fileManager.renameFile(file, newPath);
    } catch (err) {
      new Notice(`Unable to generate title:\n\n${err}`);
    } finally {
      loadingStatus.remove();
    }
  }

  private async generateTitleFromFile(file: TFile) {
    const content = await file.vault.cachedRead(file);
    return this.generateTitle(file, content);
  }

  private async generateTitleFromEditor(editor: Editor) {
    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      throw new Error('No active file');
    }

    const content = editor.getValue();
    this.generateTitle(activeFile, content);
  }

  async onload() {
    await this.loadSettings();

    this.openai = new OpenAI({
      apiKey: this.settings.openAiApiKey,
      dangerouslyAllowBrowser: true,
    });

    this.addCommand({
      id: 'title-generator-generate-title',
      name: 'Generate title',
      editorCallback: (editor) => this.generateTitleFromEditor(editor),
    });

    this.registerEvent(
      this.app.workspace.on('file-menu', (menu, file) => {
        if (!(file instanceof TFile)) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate title')
            .setIcon('lucide-edit-3')
            .onClick(() => this.generateTitleFromFile(file));
        });
      })
    );

    this.registerEvent(
      this.app.workspace.on('files-menu', (menu, files) => {
        const tFiles = files.filter((f) => f instanceof TFile) as TFile[];
        if (tFiles.length < 1) {
          return;
        }

        menu.addItem((item) => {
          item
            .setTitle('Generate titles')
            .setIcon('lucide-edit-3')
            .onClick(() =>
              pMap<TFile, void>(tFiles, (f) => this.generateTitleFromFile(f), {
                concurrency: 1,
              })
            );
        });
      })
    );

    this.addSettingTab(new TitleGeneratorSettingTab(this.app, this));
  }

  async loadSettings() {
    this.settings = { ...DEFAULT_SETTINGS, ...(await this.loadData()) };
  }

  async saveSettings() {
    await this.saveData(this.settings);
    this.openai.apiKey = this.settings.openAiApiKey;
  }
}
