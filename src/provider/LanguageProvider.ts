import { INITIAL, Registry, parseRawGrammar, StackElement } from 'vscode-textmate';
import { createOnigScanner, createOnigString, loadWASM } from 'vscode-oniguruma';
import { Grammars } from '@/types';
import http from '../util/http';

import { M, monaco } from '@/types';

interface Cfg {
  monaco: M;
  wasm: string;
  grammars: Grammars;
}

let isLoadedWASM = false;

export type LanguageInfo = {
  tokensProvider: monaco.languages.EncodedTokensProvider | null;
  configuration: monaco.languages.LanguageConfiguration | null;
};

class LanguageProvider {
  private monaco: M;
  private wasm: string;
  private registry!: Registry;
  private grammars: Grammars;
  private disposes: monaco.IDisposable[] = [];

  constructor(cfg: Cfg) {
    this.monaco = cfg.monaco;
    this.wasm = cfg.wasm;
    this.grammars = cfg.grammars;
  }

  public getRegistry() {
    return this.registry;
  }

  public bindLanguage() {
    console.log('registerLanguage onLanguage', this.grammars);
    for (const [languageId] of Object.entries(this.grammars)) {
      console.log('registerLanguage onLanguage 00', languageId);
      const item = this.grammars[languageId];
      if (item.extra) {
        console.log('this.monaco.languages.register', item.extra);
        this.monaco.languages.register(item.extra);
      }
      const dispose = this.monaco.languages.onLanguage(languageId, async () => {
        console.log('registerLanguage onLanguage 11', languageId);
        await this.registerLanguage(languageId);
      });
      this.disposes.push(dispose);
    }
  }

  public async loadRegistry() {
    if (!isLoadedWASM) {
      await loadWASM(await this.loadVSCodeOnigurumWASM());
      isLoadedWASM = true;
    }
    const registry = new Registry({
      onigLib: Promise.resolve({
        createOnigScanner,
        createOnigString,
      }),
      loadGrammar: async (scopeName) => {
        console.log('loadGrammar', scopeName);
        const key = Object.keys(this.grammars).find((k) => this.grammars[k].scopeName === scopeName);
        const grammar = this.grammars[key as keyof typeof this.grammars];
        if (grammar) {
          const res = await http(`${grammar.tm}`);
          console.log('loadGrammar[res]=', scopeName, res);
          const type = grammar.tm.substring(grammar.tm.lastIndexOf('.') + 1);
          console.log('loadGrammar[type]=', scopeName, type);
          return parseRawGrammar(res, `example.${type}`);
        }
        return Promise.resolve(null);
      },
    });

    this.registry = registry;

    this.bindLanguage();
  }

  public async registerLanguage(languageId: string) {
    const { tokensProvider, configuration } = await this.fetchLanguageInfo(languageId);
    
    if (configuration !== null) {
      this.monaco.languages.setLanguageConfiguration(languageId, configuration);
    }

    if (tokensProvider !== null) {
      this.monaco.languages.setTokensProvider(languageId, tokensProvider);
    }
  }

  public async fetchLanguageInfo(languageId: string): Promise<LanguageInfo> {
    console.log('fetchLanguageInfo', languageId);
    const [configuration, tokensProvider] = await Promise.all([
      this.getConfiguration(languageId),
      this.getTokensProvider(languageId),
    ]);

    return { configuration, tokensProvider };
  }

  // 获取语法配置JSON文件
  public async getConfiguration(languageId: string): Promise<monaco.languages.LanguageConfiguration | null> {
    const grammar = this.grammars[languageId];
    if (grammar.cfg) {
      const res = await http(`${grammar.cfg}`);
      return JSON.parse(res);
    }
    return Promise.resolve(null);
  }

  // 获取TextMate配置JSON文件
  public async getTokensProvider(languageId: string): Promise<monaco.languages.EncodedTokensProvider | null> {
    console.log("获取TextMate配置JSON文件")
    const scopeName = this.getScopeNameFromLanguageId(languageId);
    const grammar = await this.registry.loadGrammar(scopeName);

    if (!grammar) return null;

    return {
      getInitialState() {
        return INITIAL;
      },
      tokenizeEncoded(line: string, state: monaco.languages.IState): monaco.languages.IEncodedLineTokens {
        const tokenizeLineResult2 = grammar.tokenizeLine2(line, state as StackElement);
        const { tokens, ruleStack: endState } = tokenizeLineResult2;
        return { tokens, endState };
      },
    };
  }

  public getScopeNameFromLanguageId(languageId: string) {
    for (const [key, value] of Object.entries(this.grammars)) {
      if (key === languageId) {
        return value.scopeName;
      }
    }
    throw new Error(`can not find scopeName with languageId: ${languageId}`);
  }

  public async loadVSCodeOnigurumWASM() {
    const response = await fetch(this.wasm);
    const contentType = response.headers.get('content-type');
    console.log("contenttype = ", contentType)
    if (contentType === 'application/wasm') {
      return response;
    }
    // Using the response directly only works if the server sets the MIME type 'application/wasm'.
    // Otherwise, a TypeError is thrown when using the streaming compiler.
    // We therefore use the non-streaming compiler :(.
    return await response.arrayBuffer();
  }

  public dispose() {
    this.disposes.forEach((d) => d.dispose());
    this.registry?.dispose();
  }
}

export default LanguageProvider;
